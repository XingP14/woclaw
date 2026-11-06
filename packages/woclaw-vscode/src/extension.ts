import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import {
  HubAgent,
  HubHealthBody,
  HubMemoryEntry,
  HubTopic,
  extractAgents,
  extractMemory,
  extractTopics,
  topicMembers,
} from './hub-api';

// R534: these four payload shapes are NOT declared here any more. They live
// in ./hub-api.ts, which is pinned against the REAL Hub's responses by
// integration-test/vscode-hub-contract.test.ts. The previous inline
// declarations disagreed with the Hub on all four endpoints (bare array vs
// envelope; `id` vs `agentId`; `agents: string[]` vs a count; `updatedAt`
// as a string vs epoch millis), and the mismatch crashed the tree providers
// on `.map()` / `.filter()`. See hub-api.ts for the full table.

function createTreeEvents<T>(): { emitter: vscode.EventEmitter<T>; event: vscode.Event<T> } {
  const emitter = new vscode.EventEmitter<T>();
  return { emitter, event: emitter.event };
}

let statusBarItem: vscode.StatusBarItem;
let pollTimer: NodeJS.Timeout | null = null;
let treeRefresh: (() => void) | null = null;

function getHubUrl(): string {
  return vscode.workspace.getConfiguration('woclaw').get<string>('hubUrl') || 'http://localhost:8083';
}

function httpGet<T = unknown>(path: string): Promise<T | null> {
  return new Promise((resolve) => {
    const url = getHubUrl();
    const req = http.get(`${url}${path}`, (res: http.IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function fetchHubHealth(): Promise<HubHealthBody | null> {
  return httpGet<HubHealthBody>('/health');
}

interface HubStatusBar {
  text: string;
  color: string;
}

// formatHubStatusBar: centralize the 2 statusBarItem.text+color templates used
// by updateStatusBar. Without this helper, the `$(hubot) WoClaw:` prefix + the
// green/red hex codes were duplicated across the connected + disconnected
// branches, which risks drift if one site changes. Chain #18
// status-bar-format-extraction parallels woclaw-side hub chain #15/#16.
function formatHubStatusBar(health: HubHealthBody | null): HubStatusBar {
  if (health && health.status === 'ok') {
    return {
      text: `$(hubot) WoClaw: ${health.agents} agents / ${health.topics} topics`,
      color: '#4caf50',
    };
  }
  return {
    text: '$(hubot) WoClaw: Disconnected',
    color: '#f44336',
  };
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

async function updateStatusBar() {
  const cfg = vscode.workspace.getConfiguration('woclaw');
  if (!cfg.get<boolean>('statusBar')) { statusBarItem.hide(); return; }
  const health = await fetchHubHealth();
  const fmt = formatHubStatusBar(health);
  statusBarItem.text = fmt.text;
  statusBarItem.color = fmt.color;
  statusBarItem.show();
}

// ─── Tree Data Providers ─────────────────────────────────────────────────────

class TopicsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  // Resolved at module load (out/extension.js → ../../media/topic.svg).
  // Hoisted from a per-render `require('path').join(...)` so the path module is
  // imported once at the top of the file (ESM-style) instead of being lazily
  // resolved on every tree refresh — parallels the require()→top-level-import
  // migration done in 8e8a6de for src/core/evaluator.ts.
  private static readonly TOPIC_ICON_URI = vscode.Uri.file(
    path.join(__dirname, '..', '..', 'media', 'topic.svg')
  );
  private readonly treeEvents = createTreeEvents<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.treeEvents.event;
  topics: HubTopic[] = [];
  // R534: the agents list is fetched alongside the topics because the Hub's
  // REST surface has NO topic-members endpoint — member lists exist only over
  // the WebSocket. GET /agents carries each agent's topic list, so the
  // members of a topic are derived from it (see hub-api.ts topicMembers).
  private agents: HubAgent[] = [];

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }
  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (el && el.contextValue === 'topic') {
      const t = el as vscode.TreeItem & { topicName: string };
      const members = topicMembers(t.topicName, this.agents);
      return members.map(a => {
        const i = new vscode.TreeItem(a.agentId);
        i.iconPath = new vscode.ThemeIcon('account');
        return i;
      });
    }
    return this.topics.map(t => {
      const item = new vscode.TreeItem(t.name) as vscode.TreeItem & { topicName: string };
      item.topicName = t.name;
      // R534: `agents` on a topic row is a COUNT (number), not an array.
      // The previous code typed it as string[] and rendered `t.agents.length`
      // plus a `t.type` / `t.messageCount` that the Hub never sends.
      const memberCount = typeof t.agents === 'number' ? t.agents : topicMembers(t.name, this.agents).length;
      item.description = `${memberCount} agent${memberCount === 1 ? '' : 's'}`;
      item.contextValue = 'topic';
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.iconPath = TopicsTreeDataProvider.TOPIC_ICON_URI;
      item.tooltip = `${memberCount} agent${memberCount === 1 ? '' : 's'}`;
      return item;
    });
  }
  async refresh(): Promise<void> {
    this.topics = extractTopics(await httpGet<unknown>('/topics'));
    this.agents = extractAgents(await httpGet<unknown>('/agents'));
    this.treeEvents.emitter.fire(undefined);
  }
}

class AgentsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly treeEvents = createTreeEvents<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.treeEvents.event;
  agents: HubAgent[] = [];

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }
  async getChildren(): Promise<vscode.TreeItem[]> {
    return this.agents.map(a => {
      // R534: the id field is `agentId`, not `id`; connectedAt/lastSeen are
      // epoch millis (numbers), so they are formatted as dates explicitly.
      const item = new vscode.TreeItem(a.agentId);
      item.iconPath = new vscode.ThemeIcon('hubot');
      item.tooltip = `Connected: ${new Date(a.connectedAt).toLocaleString()} • Topics: ${a.topics.join(', ')}`;
      return item;
    });
  }
  async refresh(): Promise<void> {
    this.agents = extractAgents(await httpGet<unknown>('/agents'));
    this.treeEvents.emitter.fire(undefined);
  }
}

class MemoryTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  query = '';
  entries: HubMemoryEntry[] = [];

  async search(q: string) {
    this.query = q;
    const all = extractMemory(await httpGet<unknown>('/memory?limit=50'));
    this.entries = q
      ? all.filter((m) =>
          m.key.toLowerCase().includes(q.toLowerCase()) ||
          m.value.toLowerCase().includes(q.toLowerCase()))
      : all;
    this.treeEvents.emitter.fire(undefined);
  }

  private readonly treeEvents = createTreeEvents<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.treeEvents.event;

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }
  async getChildren(): Promise<vscode.TreeItem[]> {
    return this.entries.map(m => {
      const item = new vscode.TreeItem(m.key);
      item.iconPath = new vscode.ThemeIcon('symbol-key');
      item.tooltip = `${m.value.substring(0, 120)}${m.value.length > 120 ? '…' : ''}\nTags: ${m.tags.join(', ')}`;
      item.description = m.value.substring(0, 60) + (m.value.length > 60 ? '…' : '');
      return item;
    });
  }
}

// ─── Activation ─────────────────────────────────────────────────────────────

export function activate(_context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'woclaw.showDashboard';
  updateStatusBar();
  const pollIntervalSec = vscode.workspace.getConfiguration('woclaw').get<number>('pollInterval') ?? 30;
  pollTimer = setInterval(updateStatusBar, pollIntervalSec * 1000);

  const memoryProvider = new MemoryTreeDataProvider();
  const topicsProvider = new TopicsTreeDataProvider();
  const agentsProvider = new AgentsTreeDataProvider();

  // Initial data load
  void topicsProvider.refresh();
  void agentsProvider.refresh();
  void memoryProvider.search('');

  vscode.window.registerTreeDataProvider('woclaw-topics', topicsProvider);
  vscode.window.registerTreeDataProvider('woclaw-agents', agentsProvider);
  vscode.window.registerTreeDataProvider('woclaw-memory', memoryProvider);

  // Register commands
  vscode.commands.registerCommand('woclaw.showDashboard', async (_args: unknown) => {
    const health = await fetchHubHealth();
    const url = getHubUrl();
    if (health) {
      vscode.window.showInformationMessage(
        `WoClaw Hub: ${health.agents} agents, ${health.topics} topics — ${url}`, { modal: false });
    } else {
      vscode.window.showWarningMessage(`WoClaw Hub unreachable at ${url}`);
    }
  });

  vscode.commands.registerCommand('woclaw.refreshAll', async (_args: unknown) => {
    await updateStatusBar();
    memoryProvider.search(memoryProvider.query);
    vscode.window.showInformationMessage('WoClaw: Refreshed');
  });

  vscode.commands.registerCommand('woclaw.memorySearch', async (_args: unknown) => {
    const q = await vscode.window.showInputBox({ prompt: 'Search WoClaw memory…' });
    if (q !== undefined) memoryProvider.search(q);
  });

  // Set context flag for viewsWelcome
  vscode.commands.executeCommand('setContext', 'woclaw.hasData', true);

  treeRefresh = () => { memoryProvider.search(memoryProvider.query); };
}

export function deactivate() {
  if (pollTimer) clearInterval(pollTimer);
  statusBarItem?.dispose();
}

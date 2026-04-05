import * as vscode from 'vscode';
import * as http from 'http';

interface HubHealth { status: string; agents: number; topics: number; }
interface Topic { name: string; agents: string[]; messageCount: number; type: string; }
interface Agent { id: string; connectedAt: string; topics: string[]; lastSeen: string; }
interface MemoryEntry { key: string; value: string; tags: string[]; updatedAt: string; }

let statusBarItem: vscode.StatusBarItem;
let pollTimer: NodeJS.Timeout | null = null;
let treeRefresh: (() => void) | null = null;

function getHubUrl(): string {
  return vscode.workspace.getConfiguration('woclaw').get<string>('hubUrl') || 'http://localhost:8083';
}

function httpGet(path: string): Promise<any> {
  return new Promise((resolve) => {
    const url = getHubUrl();
    const req = http.get(`${url}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function fetchHubHealth(): Promise<HubHealth | null> {
  return httpGet('/health');
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

async function updateStatusBar() {
  const cfg = vscode.workspace.getConfiguration('woclaw');
  if (!cfg.get<boolean>('statusBar')) { statusBarItem.hide(); return; }
  const health = await fetchHubHealth();
  if (health && health.status === 'ok') {
    statusBarItem.text = `$(hubot) WoClaw: ${health.agents} agents / ${health.topics} topics`;
    statusBarItem.color = '#4caf50';
    statusBarItem.show();
  } else {
    statusBarItem.text = `$(hubot) WoClaw: Disconnected`;
    statusBarItem.color = '#f44336';
    statusBarItem.show();
  }
}

// ─── Tree Data Providers ─────────────────────────────────────────────────────

class TopicsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  topics: Topic[] = [];

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }
  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (el && el.contextValue === 'topic') {
      const t = el as vscode.TreeItem & Topic;
      return t.agents.map(a => {
        const i = new vscode.TreeItem(a);
        i.iconPath = new vscode.ThemeIcon('account');
        return i;
      });
    }
    return this.topics.map(t => {
      const item = new vscode.TreeItem(t.name) as vscode.TreeItem & Topic;
      (item as any).name = t.name;
      (item as any).agents = t.agents;
      (item as any).messageCount = t.messageCount;
      (item as any).type = t.type;
      item.contextValue = 'topic';
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.iconPath = vscode.Uri.file(
        require('path').join(__dirname, '..', '..', 'media', 'topic.svg'));
      item.tooltip = `${t.type} • ${t.messageCount} messages • ${t.agents.length} agents`;
      return item;
    });
  }
  async refresh(): Promise<void> {
    this.topics = await httpGet('/topics') || [];
    this._onDidChangeTreeData.fire();
  }
}

class AgentsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  agents: Agent[] = [];

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }
  async getChildren(): Promise<vscode.TreeItem[]> {
    return this.agents.map(a => {
      const item = new vscode.TreeItem(a.id);
      item.iconPath = new vscode.ThemeIcon('hubot');
      item.tooltip = `Connected: ${new Date(a.connectedAt).toLocaleString()} • Topics: ${a.topics.join(', ')}`;
      return item;
    });
  }
  async refresh(): Promise<void> {
    this.agents = await httpGet('/agents') || [];
    this._onDidChangeTreeData.fire();
  }
}

class MemoryTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  query = '';
  entries: MemoryEntry[] = [];

  async search(q: string) {
    this.query = q;
    this.entries = q
      ? ((await httpGet(`/memory?limit=50`)) || []).filter((m: MemoryEntry) =>
          m.key.toLowerCase().includes(q.toLowerCase()) ||
          m.value.toLowerCase().includes(q.toLowerCase()))
      : ((await httpGet(`/memory?limit=50`)) || []);
    this._onDidChangeTreeData.fire();
  }

  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

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
  pollTimer = setInterval(updateStatusBar, 30_000);

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
  vscode.commands.registerCommand('woclaw.showDashboard', async () => {
    const health = await fetchHubHealth();
    const url = getHubUrl();
    if (health) {
      vscode.window.showInformationMessage(
        `WoClaw Hub: ${health.agents} agents, ${health.topics} topics — ${url}`, { modal: false });
    } else {
      vscode.window.showWarningMessage(`WoClaw Hub unreachable at ${url}`);
    }
  });

  vscode.commands.registerCommand('woclaw.refreshAll', async () => {
    await updateStatusBar();
    memoryProvider.search(memoryProvider.query);
    vscode.window.showInformationMessage('WoClaw: Refreshed');
  });

  vscode.commands.registerCommand('woclaw.memorySearch', async () => {
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

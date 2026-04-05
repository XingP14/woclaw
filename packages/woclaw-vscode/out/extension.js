"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
let statusBarItem;
let pollTimer = null;
let treeRefresh = null;
function getHubUrl() {
    return vscode.workspace.getConfiguration('woclaw').get('hubUrl') || 'http://localhost:8083';
}
function httpGet(path) {
    return new Promise((resolve) => {
        const url = getHubUrl();
        const req = http.get(`${url}${path}`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    });
}
async function fetchHubHealth() {
    return httpGet('/health');
}
// ─── Status Bar ───────────────────────────────────────────────────────────────
async function updateStatusBar() {
    const cfg = vscode.workspace.getConfiguration('woclaw');
    if (!cfg.get('statusBar')) {
        statusBarItem.hide();
        return;
    }
    const health = await fetchHubHealth();
    if (health && health.status === 'ok') {
        statusBarItem.text = `$(hubot) WoClaw: ${health.agents} agents / ${health.topics} topics`;
        statusBarItem.color = '#4caf50';
        statusBarItem.show();
    }
    else {
        statusBarItem.text = `$(hubot) WoClaw: Disconnected`;
        statusBarItem.color = '#f44336';
        statusBarItem.show();
    }
}
// ─── Tree Data Providers ─────────────────────────────────────────────────────
class TopicsTreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.topics = [];
    }
    getTreeItem(el) { return el; }
    async getChildren(el) {
        if (el && el.contextValue === 'topic') {
            const t = el;
            return t.agents.map(a => {
                const i = new vscode.TreeItem(a);
                i.iconPath = new vscode.ThemeIcon('account');
                return i;
            });
        }
        return this.topics.map(t => {
            const item = new vscode.TreeItem(t.name);
            item.name = t.name;
            item.agents = t.agents;
            item.messageCount = t.messageCount;
            item.type = t.type;
            item.contextValue = 'topic';
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            item.iconPath = vscode.Uri.file(require('path').join(__dirname, '..', '..', 'media', 'topic.svg'));
            item.tooltip = `${t.type} • ${t.messageCount} messages • ${t.agents.length} agents`;
            return item;
        });
    }
    async refresh() {
        this.topics = await httpGet('/topics') || [];
        this._onDidChangeTreeData.fire();
    }
}
class AgentsTreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.agents = [];
    }
    getTreeItem(el) { return el; }
    async getChildren() {
        return this.agents.map(a => {
            const item = new vscode.TreeItem(a.id);
            item.iconPath = new vscode.ThemeIcon('hubot');
            item.tooltip = `Connected: ${new Date(a.connectedAt).toLocaleString()} • Topics: ${a.topics.join(', ')}`;
            return item;
        });
    }
    async refresh() {
        this.agents = await httpGet('/agents') || [];
        this._onDidChangeTreeData.fire();
    }
}
class MemoryTreeDataProvider {
    constructor() {
        this.query = '';
        this.entries = [];
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    async search(q) {
        this.query = q;
        this.entries = q
            ? ((await httpGet(`/memory?limit=50`)) || []).filter((m) => m.key.toLowerCase().includes(q.toLowerCase()) ||
                m.value.toLowerCase().includes(q.toLowerCase()))
            : ((await httpGet(`/memory?limit=50`)) || []);
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(el) { return el; }
    async getChildren() {
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
function activate(_context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'woclaw.showDashboard';
    updateStatusBar();
    pollTimer = setInterval(updateStatusBar, 30000);
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
            vscode.window.showInformationMessage(`WoClaw Hub: ${health.agents} agents, ${health.topics} topics — ${url}`, { modal: false });
        }
        else {
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
        if (q !== undefined)
            memoryProvider.search(q);
    });
    // Set context flag for viewsWelcome
    vscode.commands.executeCommand('setContext', 'woclaw.hasData', true);
    treeRefresh = () => { memoryProvider.search(memoryProvider.query); };
}
function deactivate() {
    if (pollTimer)
        clearInterval(pollTimer);
    statusBarItem?.dispose();
}

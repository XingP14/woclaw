// ========================================================================
// OpenClaw Plugin SDK Type Stubs
// These match the OpenClaw SDK types for plugin development
// ========================================================================

// Re-export for use in channel.ts without needing module resolution
export type ChannelId = string;

export type ChannelMeta = {
  id: ChannelId;
  label: string;
  selectionLabel: string;
  docsPath: string;
  docsLabel?: string;
  blurb: string;
  order?: number;
  aliases?: readonly string[];
  selectionDocsPrefix?: string;
  selectionDocsOmitLabel?: boolean;
};

export type ChannelCapabilities = {
  chatTypes: Array<'direct' | 'group' | 'channel' | 'thread'>;
  polls?: boolean;
  reactions?: boolean;
  edit?: boolean;
  unsend?: boolean;
  reply?: boolean;
  effects?: boolean;
  groupManagement?: boolean;
  threads?: boolean;
  media?: boolean;
  nativeCommands?: boolean;
  blockStreaming?: boolean;
};

export type ChannelConfigAdapter<ResolvedAccount> = {
  listAccountIds(cfg: any): string[];
  resolveAccount(cfg: any, accountId?: string | null): ResolvedAccount;
  inspectAccount?(cfg: any, accountId?: string | null): any;
  defaultAccountId?(cfg: any): string;
  isConfigured?(account: ResolvedAccount, cfg: any): boolean;
  unconfiguredReason?(account: ResolvedAccount, cfg: any): string;
};

export type ChannelSetupInput = any;

export type RuntimeEnv = {
  dispatch?: (msg: any) => void;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
    debug: (msg: string) => void;
  };
  [key: string]: any;
};

export type ChannelSetupAdapter = {
  resolveAccountId?(params: { cfg: any; accountId?: string; input?: ChannelSetupInput }): string;
  applyAccountConfig(params: { cfg: any; accountId: string; input: ChannelSetupInput }): any;
  afterAccountConfigWritten?(params: { previousCfg: any; cfg: any; accountId: string; input: ChannelSetupInput; runtime: RuntimeEnv }): void | Promise<void>;
  destroyAccount?(params: { cfg: any; accountId: string; runtime: RuntimeEnv }): void | Promise<void>;
};

export type ChannelPlugin<ResolvedAccount = any, Probe = unknown, Audit = unknown> = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter<ResolvedAccount>;
  setup: ChannelSetupAdapter;
  messaging?: any;
  outbound?: any;
  [key: string]: any;
};

export type PluginRuntime = {
  dispatch?: (message: any) => void;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
    debug: (msg: string) => void;
  };
  [key: string]: any;
};

export type OpenClawPluginApi = {
  registerChannel(opts: { plugin: ChannelPlugin }): void;
  registerTool(opts: any): void;
  registerHook(opts: any): void;
  registerCommand(opts: any): void;
  registerCli(opts: any): void;
  registerHttpRoute(opts: any): void;
  registrationMode: 'full' | 'setup-only' | 'setup-runtime';
  runtime: PluginRuntime;
  logger: PluginRuntime['logger'];
  cfg: any;
};

export type OpenClawPluginConfigSchema = {
  schema: Record<string, any>;
  uiHints?: Record<string, any>;
};

export type DefineChannelPluginEntryOptions<TPlugin = ChannelPlugin> = {
  id: string;
  name: string;
  description: string;
  plugin: TPlugin;
  configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
  setRuntime?: (runtime: PluginRuntime) => void;
  registerFull?: (api: OpenClawPluginApi) => void;
};

export type DefinedChannelPluginEntry<TPlugin> = {
  id: string;
  name: string;
  description: string;
  configSchema: OpenClawPluginConfigSchema;
  register: (api: OpenClawPluginApi) => void;
  channelPlugin: TPlugin;
  setChannelRuntime?: (runtime: PluginRuntime) => void;
};

export function defineChannelPluginEntry<TPlugin>(options: DefineChannelPluginEntryOptions<TPlugin>): DefinedChannelPluginEntry<TPlugin>;

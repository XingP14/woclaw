// Type declaration for openclaw/plugin-sdk/core
// This allows TypeScript to find the module during build
// At runtime, the actual openclaw package provides this module

declare module 'openclaw/plugin-sdk/core' {
  export type ChannelPlugin<ResolvedAccount = any, Probe = unknown, Audit = unknown> = {
    id: string;
    meta: {
      id: string;
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
    capabilities: {
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
    config: any;
    setup: any;
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

  export function defineChannelPluginEntry<TPlugin>(options: {
    id: string;
    name: string;
    description: string;
    plugin: TPlugin;
    configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
    setRuntime?: (runtime: PluginRuntime) => void;
    registerFull?: (api: OpenClawPluginApi) => void;
  }): {
    id: string;
    name: string;
    description: string;
    configSchema: OpenClawPluginConfigSchema;
    register: (api: OpenClawPluginApi) => void;
    channelPlugin: TPlugin;
    setChannelRuntime?: (runtime: PluginRuntime) => void;
  };
}

// Type definitions for OpenClaw Channel Plugin SDK
// These types are used by the WoClaw plugin to implement the ChannelPlugin interface

export interface ChannelPluginContext {
  config: Record<string, unknown>;
  dispatch(message: unknown): void;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string, ...args: unknown[]) => void;
    debug: (msg: string) => void;
  };
}

export interface ChannelPlugin {
  name: string;
  initialize(ctx: ChannelPluginContext): Promise<void>;
  shutdown?(): Promise<void>;
}

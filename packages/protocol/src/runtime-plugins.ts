export const RUNTIME_PLUGINS_INSTALL = "runtime.plugins.install" as const;
export const RUNTIME_PLUGINS_INSTALL_RESULT = "runtime.plugins.install.result" as const;

export type RuntimePluginFile = { path: string; content: string };

export type RuntimePluginsInstallCommandPayload = {
  commandId?: string;
  /** OpenClaw plugins to copy into the Instance; `files` are relative to each plugin's folder. */
  plugins: Array<{ id: string; files: RuntimePluginFile[] }>;
};

export type RuntimePluginsInstallResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    /** `changed: false` means the identical plugin was already installed: no Gateway restart needed for it. */
    plugins: Array<{ id: string; changed: boolean }>;
  };
};

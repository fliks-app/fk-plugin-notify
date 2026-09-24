/**
 * Config arrives as `FLIKS_CFG_<KEY>` env vars, fixed for the life of the
 * process. A `config` note only names which settings keys changed, not
 * their new values (see `PluginApi['config']` in the Fliks contract); core's
 * `config.get` could fetch the new value, but this phase just logs the note
 * and leaves the effective config to change on the next respawn.
 */
export interface PluginConfig {
  targetUrl: string | null;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): PluginConfig {
  return { targetUrl: env.FLIKS_CFG_TARGET_URL?.trim() || null };
}

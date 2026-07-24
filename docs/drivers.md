# Driver guide

A driver teaches fe2o3 how to talk to one family of devices: what the CLI
prompt looks like, which commands produce the configuration, and what to scrub
before committing.

## Anatomy

```ts
import { defineDriver, dropLines, hideSecret } from '@fe2o3/driver-sdk';

export default defineDriver({
  id: 'ios',                                // devices reference this as their model
  displayName: 'Cisco IOS / IOS-XE',
  prompt: /^[\w.@()/:-]+[#>]\s?$/m,         // matches the CLI prompt
  errorPatterns: [/^% Invalid/m],           // output that fails the command
  comment: '! ',                            // section-header prefix in stored config
  init: [{ cmd: 'terminal length 0' }],     // session setup (disable paging!)
  enable: { cmd: 'enable', passPrompt: /Password:/i },   // optional priv escalation
  telnetLogin: { userPrompt: /Username:/, passPrompt: /Password:/ }, // telnet only
  commands: [
    { cmd: 'show version', name: 'version' },
    { cmd: 'show running-config', name: 'running-config' },
  ],
  scrubbers: [
    dropLines(/^ntp clock-period /),                    // volatile noise → clean diffs
    hideSecret(/^enable secret (?:\d )?(\S+)/gm),       // capture group → "<secret hidden>"
  ],
  vars: [                                    // per-device knobs shown in the UI
    { key: 'enablePassword', description: '…', type: 'string' },
  ],
});
```

Execution order: connect → (telnet login) → wait for prompt → `enable` → `init`
steps → each command (expect prompt, check `errorPatterns`, apply `transform`)
→ join sections with `comment` headers → run `scrubbers` → commit.

Helpers:

- `hideSecret(regex)` — replaces the **first capture group** with
  `<secret hidden>`, keeping surrounding context. Use `gm` flags.
- `dropLines(regex)` — removes matching lines entirely. Use for content that
  changes every run (timestamps, counters) so diffs only show real changes.

## Plugin drivers

Drop an ES module into `<dataDir>/drivers/*.mjs` and restart:

```js
// <dataDir>/drivers/fortios.mjs
export default {
  id: 'fortios',
  displayName: 'Fortinet FortiOS',
  prompt: /^[\w-]+ [#$] $/m,
  comment: '# ',
  init: [{ cmd: 'config system console' }, { cmd: 'set output standard' }, { cmd: 'end' }],
  commands: [{ cmd: 'show full-configuration', name: 'configuration' }],
  scrubbers: [
    (text) => text.replace(/set (?:password|passwd|private-key) .*/g, 'set password <secret hidden>'),
  ],
};
```

Plugins can be plain objects (the `defineDriver` helper is just typing sugar).
A plugin with the same `id` as a built-in overrides it. The Models page in the
UI lists everything registered.

## Tips

- **Always disable paging** in `init` — a `--More--` prompt will hang the
  session until the expect timeout.
- Test your prompt regex against enable mode, config mode, and hostname changes.
- Prefer `dropLines` for volatile output over committing it — the whole point is
  meaningful diffs.
- The e2e test fixtures (`apps/server/test/fixtures/fake-ssh-server.ts`) make it
  easy to replay a captured transcript against your driver in vitest.
- Legacy SSH gear: fe2o3 already offers old kex/cipher algorithms
  (`diffie-hellman-group1-sha1`, `ssh-rsa`, CBC ciphers) and falls back to
  keyboard-interactive auth automatically.

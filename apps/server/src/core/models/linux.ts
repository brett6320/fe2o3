import { defineDriver, dropLines } from '@fe2o3/driver-sdk';

/** Generic Linux / VyOS-style device: grabs system info + network config. */
export default defineDriver({
  id: 'linux',
  displayName: 'Generic Linux / VyOS',
  prompt: /[$#]\s?$/m,
  comment: '# ',
  init: [],
  commands: [
    { cmd: 'uname -a', name: 'system' },
    { cmd: 'cat /etc/os-release 2>/dev/null || true', name: 'os-release' },
    { cmd: 'ip -o addr 2>/dev/null || ifconfig -a', name: 'interfaces' },
    { cmd: 'ip route 2>/dev/null || netstat -rn', name: 'routes' },
  ],
  scrubbers: [dropLines(/^(uname -a|cat \/etc\/os-release.*|ip -o addr.*|ip route.*)$/)],
});

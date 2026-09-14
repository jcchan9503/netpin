# NetPin development rules

- Preserve the split between observed network facts and manual allocation. Never infer that an address is available solely from a timeout.
- SNMP collector is read-only. Do not introduce SET, configuration changes, credential guessing or unbounded discovery.
- Scope associations by explicit device/subnet bindings, branch, address space, VLAN/FDB context and time. Bridge port != ifIndex != faceplate number. Shared FDB and missing VLAN information are uncertain candidates.
- Failed refresh preserves prior rows as stale. Successful empty results are distinct from errors. Static/unknown ARP type does not prove current reachability.
- User data, credentials and real internal addresses never belong in Git. Use RFC 5737 fixtures and loopback agents in tests.
- Keep Electron sandbox, context isolation, disabled renderer Node integration, sender validation and the IPC allowlist. Never add production --no-sandbox flags.
- Use OS-protected credentials or memory-only sessions. Do not fall back to plaintext credential files.
- Tests: npm run check; npm test; npm run test:integration; npm run test:desktop. Test the packaged app, not only the development launch.
- Explicitly report skipped tests and absent operating-system/device validation. Do not equate a simulated SNMP agent with a physical router or generic Linux with a particular domestic OS.
- Windows packaging requires building native/NetPinPing.cs first. Update installers and docs when changing package names or platform requirements.
- Preserve user changes on remote branches; no forced pushes or silent rewrites of history.

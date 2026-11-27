// The public half of the key that signs Bloom's update feed. An update is installed only
// when the feed carries a signature this key accepts. The private half is kept on the Mac
// that builds releases (build/update-key.js) and is never committed.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAV2SHRryruQ0tpNlloZJvODor6heJHjJGr2qzqp6J0Tc=
-----END PUBLIC KEY-----
`;

module.exports = { PUBLIC_KEY };

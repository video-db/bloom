const { execFileSync } = require('node:child_process');

// A valid nested helper alone is insufficient: TCC must identify the outer app too.
function verifyMacSignature(appPath, expectedId = 'com.videodb.bloom') {
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath]);
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('codesign', ['--display', '--verbose=2', appPath], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  const details = result.stderr;
  if (
    result.status !== 0 ||
    !details.split('\n').includes(`Identifier=${expectedId}`) ||
    !/^Info.plist entries=/m.test(details) ||
    !/^Sealed Resources version=/m.test(details)
  ) {
    throw new Error(
      'Packaged app signature must bind Bloom’s identifier, Info.plist and resources.',
    );
  }
}

module.exports = { verifyMacSignature };
if (require.main === module) verifyMacSignature(process.argv[2]);

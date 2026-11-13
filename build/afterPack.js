const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { signAsync } = require('@electron/osx-sign');
const { verifyMacSignature } = require('./verify-mac-signature');

/**
 * electron-builder afterPack hook.
 *
 * 1. Adds the microphone usage description to VideoDBCapture.app Info.plist
 * 2. Signs all nested code and the outer app, binding Bloom's Info.plist and identity.
 *    Signing only the recorder leaves the outer executable identified as Electron;
 *    macOS then attributes capture to an independent executable-path permission.
 */
module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const platform = context.packager.platform.name;

  console.log('afterPack:', appOutDir);
  console.log('Platform:', platform);

  if (platform !== 'mac') return;

  const appName = context.packager.appInfo.productFilename;
  const resourcesPath = path.join(
    appOutDir,
    `${appName}.app`,
    'Contents',
    'Resources',
  );
  const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');

  const videodbAppBundle = path.join(
    unpackedPath,
    'node_modules',
    'videodb-capture',
    'bin',
    'VideoDBCapture.app',
  );
  const macosDir = path.join(videodbAppBundle, 'Contents', 'MacOS');
  const infoPlistPath = path.join(videodbAppBundle, 'Contents', 'Info.plist');

  const capturePath = path.join(macosDir, 'capture');
  const librecorderPath = path.join(macosDir, 'librecorder.dylib');

  if (!fs.existsSync(capturePath)) {
    throw new Error('Capture binary missing from packaged Bloom app.');
  }

  // --- Log binary info ---
  const fileOutput = execFileSync('file', [capturePath]).toString();
  console.log('Capture binary type:', fileOutput.trim());

  // --- Set permissions ---
  fs.chmodSync(capturePath, 0o755);
  console.log('Set capture binary permissions to 755');

  if (fs.existsSync(librecorderPath)) {
    fs.chmodSync(librecorderPath, 0o644);
    console.log('Set librecorder.dylib permissions to 644');
  }

  // --- Patch Info.plist with the microphone usage description ---
  if (fs.existsSync(infoPlistPath)) {
    try {
      let plistContent = fs.readFileSync(infoPlistPath, 'utf8');

      if (!plistContent.includes('NSMicrophoneUsageDescription')) {
        plistContent = plistContent.replace(
          '</dict>',
          '    <key>NSMicrophoneUsageDescription</key>\n' +
            '    <string>Bloom needs microphone access to record your voice.</string>\n' +
            '</dict>',
        );
        fs.writeFileSync(infoPlistPath, plistContent);
        console.log(
          'Patched VideoDBCapture Info.plist with the microphone usage description',
        );
      }
    } catch (err) {
      throw new Error('Failed to patch capture permissions.', { cause: err });
    }
  } else {
    throw new Error('Capture Info.plist missing from packaged Bloom app.');
  }

  // Local builds have no Developer ID certificate. Seal the whole bundle anyway;
  // electron-builder may subsequently replace this with a configured distribution signature.
  const appPath = path.join(appOutDir, `${appName}.app`);
  await signAsync({
    app: appPath,
    platform: 'darwin',
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    optionsForFile: () => ({
      entitlements: path.join(__dirname, 'entitlements.mac.plist'),
      hardenedRuntime: false,
    }),
  });
  verifyMacSignature(appPath, context.packager.appInfo.id);
  console.log('Verified complete Bloom bundle signature.');
};

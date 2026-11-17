const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { signAsync } = require('@electron/osx-sign');
const { verifyMacSignature } = require('./verify-mac-signature');
const { signingIdentity, withSigningKeychain } = require('./signing-identity');
const { Arch } = require('electron-builder');
const {
  prepareMacRecorder,
  hasArchitecture,
} = require('./prepare-mac-recorder');

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
  const arch = Arch[context.arch];
  await prepareMacRecorder(videodbAppBundle, arch);
  if (
    !hasArchitecture(
      path.join(appOutDir, `${appName}.app`, 'Contents', 'MacOS', appName),
      arch,
    )
  )
    throw new Error(`Packaged Electron executable does not support ${arch}`);
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

  // Signed with Bloom's own certificate when this Mac has it (build/signing-identity.js),
  // so every release shares one designated requirement and macOS keeps its permissions
  // across updates. Without it (a contributor's build) the bundle is sealed ad hoc.
  const appPath = path.join(appOutDir, `${appName}.app`);
  const identity = signingIdentity();
  console.log(
    identity
      ? `Signing with Bloom Release Signing (${identity.hash.slice(0, 8)})`
      : 'No Bloom signing certificate on this Mac: signing ad hoc',
  );
  const sign = () =>
    signAsync({
      app: appPath,
      platform: 'darwin',
      identity: identity ? identity.hash : '-',
      ...(identity ? { keychain: identity.keychain } : {}),
      identityValidation: false,
      preAutoEntitlements: false,
      optionsForFile: () => ({
        entitlements: path.join(__dirname, 'entitlements.mac.plist'),
        hardenedRuntime: false,
      }),
    });
  await (identity ? withSigningKeychain(sign) : sign());
  verifyMacSignature(appPath, context.packager.appInfo.id);
  console.log('Verified complete Bloom bundle signature.');
};

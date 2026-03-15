const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

/**
 * electron-builder afterPack hook.
 *
 * 1. Adds microphone/camera usage descriptions to VideoDBCapture.app Info.plist
 * 2. Re-codesigns the VideoDBCapture.app bundle inside-out (dylib → binary → bundle)
 *    so macOS TCC recognises it after electron-builder packing.
 *    This mirrors what the videodb SDK installer does after extraction.
 */
module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const platform = context.packager.platform.name;

  console.log('afterPack:', appOutDir);
  console.log('Platform:', platform);

  if (platform !== 'mac') return;

  const appName = context.packager.appInfo.productFilename;
  const resourcesPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');

  const videodbAppBundle = path.join(
    unpackedPath, 'node_modules', 'videodb', 'bin', 'VideoDBCapture.app'
  );
  const macosDir = path.join(videodbAppBundle, 'Contents', 'MacOS');
  const infoPlistPath = path.join(videodbAppBundle, 'Contents', 'Info.plist');

  const capturePath = path.join(macosDir, 'capture');
  const librecorderPath = path.join(macosDir, 'librecorder.dylib');

  if (!fs.existsSync(capturePath)) {
    console.error('ERROR: capture binary not found at', capturePath);
    return;
  }

  // --- Log binary info ---
  const fileOutput = execSync(`file "${capturePath}"`).toString();
  console.log('Capture binary type:', fileOutput.trim());

  // --- Set permissions ---
  fs.chmodSync(capturePath, 0o755);
  console.log('Set capture binary permissions to 755');

  if (fs.existsSync(librecorderPath)) {
    fs.chmodSync(librecorderPath, 0o644);
    console.log('Set librecorder.dylib permissions to 644');
  }

  // --- Patch Info.plist with mic/camera usage descriptions ---
  if (fs.existsSync(infoPlistPath)) {
    try {
      let plistContent = fs.readFileSync(infoPlistPath, 'utf8');

      if (!plistContent.includes('NSMicrophoneUsageDescription')) {
        plistContent = plistContent.replace(
          '</dict>',
          '    <key>NSMicrophoneUsageDescription</key>\n' +
          '    <string>VideoDB Capture needs microphone access to record audio.</string>\n' +
          '    <key>NSCameraUsageDescription</key>\n' +
          '    <string>VideoDB Capture needs camera access to record video.</string>\n' +
          '</dict>'
        );
        fs.writeFileSync(infoPlistPath, plistContent);
        console.log('Patched VideoDBCapture Info.plist with mic/camera usage descriptions');
      }
    } catch (err) {
      console.warn('Failed to patch Info.plist:', err.message);
    }
  }

  // --- Re-codesign the .app bundle inside-out ---
  // Packing can invalidate the code signature. Sign in order:
  // 1. dylib  2. capture binary  3. entire .app bundle
  try {
    if (fs.existsSync(librecorderPath)) {
      execFileSync('codesign', ['--force', '--sign', '-', librecorderPath]);
      console.log('Codesigned librecorder.dylib');
    }

    execFileSync('codesign', ['--force', '--sign', '-', capturePath]);
    console.log('Codesigned capture binary');

    execFileSync('codesign', ['--force', '--sign', '-', videodbAppBundle]);
    console.log('Codesigned VideoDBCapture.app bundle');
  } catch (err) {
    console.warn('Codesign failed (screen recording/mic may not work):', err.message);
  }
};

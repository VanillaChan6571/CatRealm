const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const xcode = require('xcode');
const {
  withEntitlementsPlist,
  withFinalizedMod,
  withInfoPlist,
} = require('@expo/config-plugins');

const APP_GROUP_ID = 'group.com.nwya.catrealm.mobile';
const SWIFT_DECRYPTOR_FILE = 'NotificationPreviewDecryptor.swift';
const NSE_TARGET_NAME = 'NotificationServiceExtension';

function uniquePush(array, value) {
  if (!array.includes(value)) array.push(value);
}

function withCommunicationNotifications(config) {
  // EAS needs app-extension entitlements declared in config before the native
  // project exists so it can provision the extension with the same shared App
  // Group that the NSE uses at runtime.
  const appExtensions =
    config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  for (const extension of appExtensions) {
    if (extension?.targetName !== NSE_TARGET_NAME) continue;
    extension.entitlements = extension.entitlements ?? {};
    const appGroups = Array.isArray(extension.entitlements['com.apple.security.application-groups'])
      ? extension.entitlements['com.apple.security.application-groups']
      : [];
    uniquePush(appGroups, APP_GROUP_ID);
    extension.entitlements['com.apple.security.application-groups'] = appGroups;
  }

  config = withInfoPlist(config, (nextConfig) => {
    const activityTypes = Array.isArray(nextConfig.modResults.NSUserActivityTypes)
      ? nextConfig.modResults.NSUserActivityTypes
      : [];
    uniquePush(activityTypes, 'INSendMessageIntent');
    nextConfig.modResults.NSUserActivityTypes = activityTypes;
    return nextConfig;
  });

  config = withEntitlementsPlist(config, (nextConfig) => {
    nextConfig.modResults['com.apple.developer.usernotifications.communication'] = true;
    nextConfig.modResults['com.apple.developer.siri'] = true;
    const appGroups = Array.isArray(nextConfig.modResults['com.apple.security.application-groups'])
      ? nextConfig.modResults['com.apple.security.application-groups']
      : [];
    uniquePush(appGroups, APP_GROUP_ID);
    nextConfig.modResults['com.apple.security.application-groups'] = appGroups;
    return nextConfig;
  });

  config = withFinalizedMod(config, [
    'ios',
    async (nextConfig) => {
      const nseInfoPlistPath = path.join(
        nextConfig.modRequest.platformProjectRoot,
        NSE_TARGET_NAME,
        'NotificationServiceExtension-Info.plist'
      );
      const nseEntitlementsPath = path.join(
        nextConfig.modRequest.platformProjectRoot,
        NSE_TARGET_NAME,
        'NotificationServiceExtension.entitlements'
      );
      const decryptorSourcePath = path.join(nextConfig.modRequest.projectRoot, 'assets', SWIFT_DECRYPTOR_FILE);
      const decryptorTargetPath = path.join(
        nextConfig.modRequest.platformProjectRoot,
        NSE_TARGET_NAME,
        SWIFT_DECRYPTOR_FILE
      );

      if (!fs.existsSync(nseInfoPlistPath) || !fs.existsSync(nseEntitlementsPath)) {
        throw new Error(
          'NotificationServiceExtension files are missing. Keep expo-notification-service-extension-plugin before withCommunicationNotifications in app.json.'
        );
      }

      const infoPlist = plist.parse(fs.readFileSync(nseInfoPlistPath, 'utf8'));
      infoPlist.NSExtension = infoPlist.NSExtension || {};
      infoPlist.NSExtension.NSExtensionAttributes =
        infoPlist.NSExtension.NSExtensionAttributes || {};

      const attributes = infoPlist.NSExtension.NSExtensionAttributes;
      const intentsSupported = Array.isArray(attributes.IntentsSupported)
        ? attributes.IntentsSupported
        : [];
      uniquePush(intentsSupported, 'INSendMessageIntent');
      attributes.IntentsSupported = intentsSupported;

      fs.writeFileSync(nseInfoPlistPath, plist.build(infoPlist));

      const entitlements = plist.parse(fs.readFileSync(nseEntitlementsPath, 'utf8'));
      // The app target owns the Siri / communication entitlements. Xcode
      // rejects those entitlements on the Notification Service Extension
      // provisioning profile, so the extension keeps only the shared App
      // Group it needs for preview-key access.
      delete entitlements['com.apple.developer.usernotifications.communication'];
      delete entitlements['com.apple.developer.siri'];
      const appGroups = Array.isArray(entitlements['com.apple.security.application-groups'])
        ? entitlements['com.apple.security.application-groups']
        : [];
      uniquePush(appGroups, APP_GROUP_ID);
      entitlements['com.apple.security.application-groups'] = appGroups;
      fs.writeFileSync(nseEntitlementsPath, plist.build(entitlements));

      if (fs.existsSync(decryptorSourcePath)) {
        fs.mkdirSync(path.dirname(decryptorTargetPath), { recursive: true });
        fs.copyFileSync(decryptorSourcePath, decryptorTargetPath);
      }

      // The NSE plugin creates its Xcode target late in the mod pipeline. Patch
      // the serialized project here, after that target exists, so the Swift
      // decryptor is actually compiled and Xcode emits the generated
      // NotificationServiceExtension-Swift.h header imported by the Obj-C NSE.
      const projectPath = path.join(
        nextConfig.modRequest.platformProjectRoot,
        `${nextConfig.modRequest.projectName}.xcodeproj`,
        'project.pbxproj'
      );
      if (!fs.existsSync(projectPath)) {
        throw new Error(`iOS project file is missing at ${projectPath}`);
      }
      const xcodeProject = xcode.project(projectPath);
      xcodeProject.parseSync();
      addDecryptorToNseTarget(xcodeProject);
      fs.writeFileSync(projectPath, xcodeProject.writeSync());

      return nextConfig;
    },
  ]);

  return config;
}

function addDecryptorToNseTarget(xcodeProject) {
  const nseTarget = xcodeProject.pbxTargetByName(NSE_TARGET_NAME)
    ?? xcodeProject.pbxTargetByName(`"${NSE_TARGET_NAME}"`);
  if (!nseTarget) {
    throw new Error('NotificationServiceExtension target is missing from the Xcode project.');
  }

  const alreadyReferenced = Object.values(xcodeProject.pbxFileReferenceSection()).some(
    (entry) => entry && typeof entry === 'object' && entry.path === SWIFT_DECRYPTOR_FILE
  );
  if (!alreadyReferenced) {
    const nseGroupKey = xcodeProject.findPBXGroupKey({ name: NSE_TARGET_NAME });
    const nseTargetKey = xcodeProject.findTargetKey(NSE_TARGET_NAME)
      ?? xcodeProject.findTargetKey(`"${NSE_TARGET_NAME}"`);
    xcodeProject.addSourceFile(
      SWIFT_DECRYPTOR_FILE,
      { target: nseTargetKey },
      nseGroupKey
    );
  }

  const configurations = xcodeProject.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configurations)) {
    const configEntry = configurations[key];
    if (!configEntry?.buildSettings) continue;
    if (configEntry.buildSettings.PRODUCT_NAME === `"${NSE_TARGET_NAME}"`) {
      configEntry.buildSettings.SWIFT_VERSION = '5.0';
      configEntry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '18.0';
    }
  }
}

module.exports = withCommunicationNotifications;

// Adds iOS "scene" startup, which iOS 27 requires. Without it the app crashes on launch
// on iOS 27 ("...NoSceneLifecycleAdoption" in the crash report).
//
// Expo SDK 57 doesn't include this yet (SDK 58 does). Once the project is on SDK 58,
// delete this file and its entry in app.json "plugins".
//
// What it does when the ios/ folder is generated (npx expo run:ios / prebuild):
//   1. Info.plist: tells iOS to start the app through SceneDelegate
//   2. Adds SceneDelegate.swift, which creates the window and starts React Native
//   3. AppDelegate.swift: stops creating its own window (SceneDelegate does it now)
const fs = require('fs');
const path = require('path');
const {
  withInfoPlist,
  withAppDelegate,
  withXcodeProject,
  withDangerousMod,
  IOSConfig,
} = require('expo/config-plugins');

const SCENE_DELEGATE = `import UIKit
import React

// Created by plugins/with-ios-scene-delegate.js (iOS 27 needs scene-based startup).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    window.makeKeyAndVisible()

    // A link that opened the app (for example after Google sign-in)
    if let url = connectionOptions.urlContexts.first?.url {
      RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
    }
  }

  // Links that arrive while the app is already open
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // Universal links
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

function withSceneDelegateFile(config) {
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
      const file = path.join(cfg.modRequest.platformProjectRoot, projectName, 'SceneDelegate.swift');
      fs.writeFileSync(file, SCENE_DELEGATE);
      return cfg;
    },
  ]);
  return withXcodeProject(config, (cfg) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const filepath = `${projectName}/SceneDelegate.swift`;
    if (!cfg.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: cfg.modResults,
      });
    }
    return cfg;
  });
}

function withoutAppDelegateWindow(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('with-ios-scene-delegate expects a Swift AppDelegate');
    }
    const windowBlock =
      /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif/;
    if (windowBlock.test(cfg.modResults.contents)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        windowBlock,
        '    // The window is created and React Native is started in SceneDelegate.swift'
      );
    } else if (!cfg.modResults.contents.includes('started in SceneDelegate.swift')) {
      throw new Error('with-ios-scene-delegate: could not find the window setup in AppDelegate.swift');
    }
    return cfg;
  });
}

module.exports = function withIosSceneDelegate(config) {
  config = withSceneManifest(config);
  config = withSceneDelegateFile(config);
  config = withoutAppDelegateWindow(config);
  return config;
};
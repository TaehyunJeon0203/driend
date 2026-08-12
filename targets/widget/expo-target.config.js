/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "DriendWidget",
  displayName: "Driend",
  deploymentTarget: "17.0",
  colors: {
    $accent: "#F09458",
    $widgetBackground: "#1A1A2E",
  },
  frameworks: ["SwiftUI", "WidgetKit", "AppIntents"],
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});

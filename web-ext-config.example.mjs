// Your own `pnpm run:desktop` / `pnpm run:android` settings: copy to web-ext-config.mjs (gitignored).
// Every option: https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
export default {
  sourceDir: 'dist',
  run: {
    // firefox: '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox', // desktop browser
    // adbDevice: 'emulator-5554', // run:android: `adb devices` lists them
    // firefoxApk: 'org.mozilla.firefox',
  },
};

# React Native for Web

Source: https://necolas.github.io/react-native-web/docs

## Overview
React Native for Web is a compatibility layer between React DOM and React Native. It renders React Native code in web browsers using React DOM.

## Key Features
- Uses modern React APIs (function components, hooks)
- Styles in JavaScript converted to native CSS (avoids CSS-at-scale problems)
- Core components: View, Image, Text, TextInput, ScrollView
- Advanced gesture responder system
- Babel plugin for tree-shaking unused modules

## Setup (from /docs/setup)

### Package Aliasing
```js
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      'react-native$': 'react-native-web'
    }
  }
}
```

### Babel
```json
{
  "plugins": [
    ["module-resolver", {
      "alias": { "^react-native$": "react-native-web" }
    }]
  ]
}
```

### Jest
```json
{
  "moduleNameMapper": {
    "^react-native$": "react-native-web"
  }
}
```

### Package Optimization
Use the Babel plugin for build-time optimizations:
```json
{ "plugins": ["react-native-web"] }
```

### Root Element (Full-screen apps)
```css
html, body { height: 100%; }
body { overflow: hidden; }
#root { display: flex; height: 100%; }
```

## Multi-Platform Setup (from /docs/multi-platform)

### Platform-Specific Code
```js
import { Platform } from 'react-native';
const styles = StyleSheet.create({
  height: (Platform.OS === 'web') ? 200 : 100,
});
```

### File Extensions
Use `.web.js` for web-specific implementations:
- `MyComponent.android.js`
- `MyComponent.ios.js`
- `MyComponent.web.js`

### Recommendation
Use Expo for multi-platform apps — it handles all web integration configuration.

### Webpack Config for Multi-Platform
- Compile React Native packages with Babel (`@react-native/babel-preset`)
- Resolve `.web.js` extensions before `.js`
- Alias `react-native$` to `react-native-web`

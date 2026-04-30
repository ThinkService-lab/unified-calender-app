// Required side-effect import for react-native-gesture-handler — must be at the
// very top of the entry file (above any gesture-handler consumers). Without
// this, pan/long-press/swipe gestures silently fail on Android.
import 'react-native-gesture-handler';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

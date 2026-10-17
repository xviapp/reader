import { AppRegistry } from 'react-native';

import { readerLanController } from '../process-controller';

AppRegistry.registerHeadlessTask('ReaderLan', () => async (data: { serviceId: string }) => {
  // A headless task may only join a controller created by the foreground runtime.
  await readerLanController().runHeadless(data.serviceId);
});

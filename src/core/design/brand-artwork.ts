import type { ImageSourcePropType } from 'react-native';

/** Local assets populated for this app by scripts/sync-theme.mjs. */
export const brandArtwork: { empty: ImageSourcePropType; complete: ImageSourcePropType } = {
  empty: require('../../../assets/brand/illustrations/empty-paper-v1.png'),
  complete: require('../../../assets/brand/illustrations/complete-paper-v1.png'),
};

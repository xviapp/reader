import { BrandedStartupSplash } from './branded-startup-splash';
import type { SplashContentContext } from './startup-shell';

export function StartupSplashContent(context: SplashContentContext) {
  return <BrandedStartupSplash {...context}
    image={require('../../../assets/brand/splash-icon.webp')} name="阅读" slogan="求知于卷，问道于天" />;
}

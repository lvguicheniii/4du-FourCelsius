import Svg, { Path } from 'react-native-svg';

type IconProps = { size?: number; color?: string };

/** A compact faceted ice mark designed to remain crisp in the temperature bar. */
export function TemperatureIceIcon({ size = 20, color = '#33A9DC' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Path
        d="M32 7L54 19.5V44.5L32 57L10 44.5V19.5L32 7Z"
        fill={color}
        fillOpacity="0.14"
        stroke={color}
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
      <Path
        d="M10.8 19.8L32 31.7L53.2 19.8M32 31.7V56"
        stroke={color}
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.78"
      />
      <Path d="M20 16L32 22.7L44 16" stroke={color} strokeWidth="2.1" strokeLinecap="round" strokeOpacity="0.42" />
    </Svg>
  );
}

/** A restrained thawing droplet that pairs with the faceted ice mark. */
export function TemperatureWaterIcon({ size = 22, color = '#FF7482' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Path
        d="M32 6C27.5 14.2 14 27.6 14 40.1C14 50.4 22 58 32 58C42 58 50 50.4 50 40.1C50 27.6 36.5 14.2 32 6Z"
        fill={color}
        fillOpacity="0.12"
        stroke={color}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <Path d="M23 41.5C23.4 47 27.2 50.2 32.5 50.5" stroke={color} strokeWidth="3" strokeLinecap="round" strokeOpacity="0.7" />
      <Path d="M25 27.5C27.3 23.5 30 19.7 32 16.5" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.38" />
    </Svg>
  );
}

import Svg, { Path } from 'react-native-svg';

type Props = {
  size?: number;
  color?: string;
  cracked?: boolean;
};

/** A small frost-scallop mark with distinct fragile and eternal variants. */
export function FrostShellIcon({ size = 20, color = '#7FD8F5', cracked = false }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Path
        d="M32 15C18.6 15 9.5 21.9 9.5 31.3C9.5 38.4 18.4 46.5 25.6 49.8V53.4C25.6 55.3 27.4 56.5 29.6 56.5H34.4C36.6 56.5 38.4 55.3 38.4 53.4V49.8C45.6 46.5 54.5 38.4 54.5 31.3C54.5 21.9 45.4 15 32 15Z"
        fill={color}
        fillOpacity="0.035"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {cracked ? (
        <Path
          d="M34.5 22.1L30 30.5L34.2 35.1L30.5 42"
          stroke={color}
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <Path
          d="M32 31C28.9 27.2 26.3 25.6 23.9 26.5C20.2 27.9 20.2 34.1 23.9 35.5C26.3 36.4 28.9 34.8 32 31C35.1 27.2 37.7 25.6 40.1 26.5C43.8 27.9 43.8 34.1 40.1 35.5C37.7 36.4 35.1 34.8 32 31Z"
          fill="none"
          stroke={color}
          strokeWidth="2.55"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <Path
        d="M27.5 49.5C30.5 47.6 33.5 47.6 36.5 49.5"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}

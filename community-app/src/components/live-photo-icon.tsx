import Svg, { Circle } from 'react-native-svg';

export function LivePhotoIcon({ size = 25, color = '#FFFFFF' }: { size?: number; color?: string }) {
  const center = 16;
  const dots = Array.from({ length: 18 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 18 - Math.PI / 2;
    return {
      cx: center + Math.cos(angle) * 13,
      cy: center + Math.sin(angle) * 13,
    };
  });

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityElementsHidden>
      {dots.map((dot, index) => (
        <Circle key={index} cx={dot.cx} cy={dot.cy} r={1.05} fill={color} />
      ))}
      <Circle cx={center} cy={center} r={8.6} fill="none" stroke={color} strokeWidth={2.2} />
      <Circle cx={center} cy={center} r={3.9} fill="none" stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}

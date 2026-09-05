import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

type Props = {
  name: string;
  size: number;
  color: string;
};

export function BoardIcon({ name, size, color }: Props) {
  if (name === 'shirt-outline') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d="M9 3.5 6.2 4.9 3.9 8.1l2.4 1.6L8 7.9v4.5h8V7.9l1.7 1.8 2.4-1.6-2.3-3.2L15 3.5c-.5 1.3-1.5 2-3 2s-2.5-.7-3-2Z"
          stroke={color}
          strokeWidth="1.55"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M7.5 13.7h9l-.6 6.8h-3.1L12 16.7l-.8 3.8H8.1l-.6-6.8Z"
          stroke={color}
          strokeWidth="1.55"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  if (name === 'bed-outline') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path fill={color} d="M14.3 3.2h6v1.6l-3.6 3.8h3.8v1.8h-6.4V8.8l3.7-3.8h-3.5V3.2Z" />
        <Path fill={color} d="M8.7 9.4h4.8v1.4l-2.9 3h3.1v1.6H8.5V14l3-3H8.7V9.4Z" />
        <Path fill={color} d="M4 15.1h3.7v1.2l-2.1 2.2h2.3V20H3.8v-1.3L6 16.5H4v-1.4Z" />
      </Svg>
    );
  }
  if (name.startsWith('emoticon-') && name in MaterialCommunityIcons.glyphMap) {
    return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
  }
  const ioniconName = name in Ionicons.glyphMap ? name : 'grid-outline';
  return <Ionicons name={ioniconName as any} size={size} color={color} />;
}

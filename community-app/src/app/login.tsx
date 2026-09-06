import { useTheme } from "@/lib/theme";
import { useEffect, useRef, useState } from 'react';
import { Pressable } from '@/components/pressable';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { Alert } from '@/components/app-alert';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { launchImageLibrarySafely } from '@/lib/image-picker';
import { forgotPasswordStep2, login as apiLogin, register as apiRegister, sendCode, uploadFile, updateProfile, reportAchievementEvent } from '@/api/client';
import { useAuth } from '@/contexts/auth';
import { AgeWheelPicker } from '@/components/age-wheel-picker';
import { GenderSymbol } from '@/components/gender-badge';

const SECURITY_QUESTIONS = [
  '你最喜欢的季节是什么？',
  '你最喜欢的颜色是什么？',
  '你最喜欢的饮料是什么？',
  '你最喜欢的动物是什么？',
  '你最喜欢的电影类型是什么？',
  '你最常用的手机功能是什么？',
  '你最喜欢的休闲活动是什么？',
  '自定义问题',
];

export default function LoginScreen() {
  const { colors, isDark, setDarkMode } = useTheme();
  const router = useRouter();
  const { login: authLogin, refreshUser } = useAuth();
  const logoScale = useRef(new Animated.Value(1)).current;
  const logoTapCountRef = useRef(0);
  const lastLogoTapRef = useRef(0);
  const logoResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stardewLogo, setStardewLogo] = useState(false);
  const themeButtonMotion = useRef(new Animated.Value(0)).current;
  const themeAnimatingRef = useRef(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [avatarUri, setAvatarUri] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [age, setAge] = useState(18);
  const [ageWheelActive, setAgeWheelActive] = useState(false);
  const [securityQ, setSecurityQ] = useState('');
  const [securityA, setSecurityA] = useState('');
  const [customQ, setCustomQ] = useState('');
  const [showQPicker, setShowQPicker] = useState(false);

  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');

  const [showPw, setShowPw] = useState(false);
  const phoneValid = /^1[3-9]\d{9}$/.test(phone);
  const canSendCode = phoneValid;
  const customSecurityQuestionSelected = securityQ === '自定义问题';
  const securityQuestionValid = customSecurityQuestionSelected
    ? customQ.trim().length > 0
    : securityQ.length > 0;
  const canSubmit = phoneValid && agreed && (
    mode === 'login'
      ? password.length > 0
      : mode === 'forgot'
        ? password.length >= 10 && code.length === 6
        : password.length >= 10 && code.length === 6 && nickname.trim().length >= 1 && gender !== '' && avatarUri !== '' && securityA.trim().length >= 1 && securityQuestionValid
  );

  useEffect(() => {
    return () => {
      if (logoResetTimerRef.current) clearTimeout(logoResetTimerRef.current);
    };
  }, []);

  const bounceLogo = () => {
    const now = Date.now();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (stardewLogo) return;

    if (now - lastLogoTapRef.current > 550) logoTapCountRef.current = 0;
    lastLogoTapRef.current = now;
    logoTapCountRef.current += 1;

    if (logoResetTimerRef.current) clearTimeout(logoResetTimerRef.current);
    logoScale.stopAnimation();
    Animated.spring(logoScale, {
      toValue: 1 + Math.min(logoTapCountRef.current, 14) * 0.018,
      useNativeDriver: true,
      mass: 0.35,
      stiffness: 320,
      damping: 18,
    }).start();

    if (logoTapCountRef.current >= 14) {
      setStardewLogo(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return;
    }

    logoResetTimerRef.current = setTimeout(() => {
      logoTapCountRef.current = 0;
      Animated.spring(logoScale, {
        toValue: 1,
        useNativeDriver: true,
        mass: 0.5,
        stiffness: 220,
        damping: 16,
      }).start();
    }, 700);
  };

  const sweepThemeFromButton = () => {
    if (themeAnimatingRef.current) return;
    themeAnimatingRef.current = true;
    themeButtonMotion.setValue(0);
    setDarkMode(!isDark);
    Animated.sequence([
      Animated.timing(themeButtonMotion, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(themeButtonMotion, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      themeAnimatingRef.current = false;
    });
  };

  // 忘记密码
  const handleForgotPwStart = () => {
    setMode('forgot');
    setPassword('');
    setCode('');
    setError('');
  };

  const handleSendCode = async () => {
    setSending(true);
    setError('');
    try {
      const purpose = mode === 'register' ? 'register' : 'password_reset';
      const result = await sendCode(phone, purpose);
      const fixedCode = String(result.fixedCode || '252616');
      setCode(fixedCode);
      Alert.alert(
        purpose === 'register' ? '注册验证码' : '找回密码验证码',
        `当前固定验证码为 ${fixedCode}，已自动填入。`,
      );
    } catch (e: any) {
      setError(e.message || '发送失败');
    } finally {
      setSending(false);
    }
  };

  const pickAvatar = async () => {
    const result = await launchImageLibrarySafely({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const username = `user_${phone}`;
      let result;
      if (mode === 'register') {
        const submittedSecurityQuestion = customSecurityQuestionSelected
          ? `自定义：${customQ.trim()}`
          : securityQ;
        // 1. 先注册（先不上传头像）
        result = await apiRegister(username, password, phone, code, nickname.trim(), undefined, gender || undefined, submittedSecurityQuestion, securityA.trim(), age);
        // 注册接口成功后立即进入个人主页，头像在后台继续处理。
        await authLogin(result.token, avatarUri ? { ...result.user, avatar: avatarUri } : result.user);
        setLoading(false);
        router.replace('/(tabs)/profile' as any);
        if (stardewLogo) reportAchievementEvent('pelican_town_local').catch(() => {});
        if (avatarUri) {
          void (async () => {
            try {
              const upload = await uploadFile(avatarUri, 'a');
              await updateProfile({ avatar: upload.url });
            } finally {
              await refreshUser();
            }
          })().catch(() => {});
        }
        return;
      } else if (mode === 'forgot') {
        await forgotPasswordStep2({ phone, password, verify_code: code });
        Alert.alert('密码已重设', '请使用新密码登录');
        setMode('login');
        setPassword('');
        setCode('');
        return;
      } else {
        result = await apiLogin(phone, password);
      }
      await authLogin(result.token, result.user);
      if (stardewLogo) reportAchievementEvent('pelican_town_local').catch(() => {});
      router.replace('/');
    } catch (e: any) {
      setError(e.message || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false, animation: 'none' }} />
      <ScrollView
        contentContainerStyle={styles.container}
        scrollEnabled={!ageWheelActive}
        keyboardDismissMode="none"
        keyboardShouldPersistTaps="always"
        scrollsChildToFocus
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoRow}>
          <Pressable onPress={bounceLogo} style={styles.logoPressable}>
            <Animated.View style={[styles.logo, { transform: [{ scale: logoScale }] }]}>
              <Image
                source={stardewLogo
                  ? require('../../assets/images/StardewValley_cutout.png')
                  : isDark
                    ? require('../../assets/images/logo_night.png')
                    : require('../../assets/images/logo_day.png')}
                style={stardewLogo ? styles.stardewLogoImg : styles.logoImg}
                resizeMode="contain"
                fadeDuration={0}
              />
            </Animated.View>
          </Pressable>
          {stardewLogo && <Text style={[styles.stardewHint, { color: colors.accent }]} numberOfLines={2}>人生从此将展开新的一页，{`\n`}但前途必然是光明的！</Text>}
          <View style={styles.themeButtonAnchor}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`切换为${isDark ? '日间' : '夜间'}模式`}
              hitSlop={8}
              onPress={sweepThemeFromButton}
              style={[styles.themeButton, { backgroundColor: colors.accentBg, borderColor: colors.accent + '66' }]}
            >
              <Animated.View style={{
                transform: [
                  { rotate: themeButtonMotion.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
                  { scale: themeButtonMotion.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }) },
                ],
              }}>
                <Ionicons name={isDark ? 'sunny' : 'moon'} size={18} color={colors.accent} />
              </Animated.View>
            </Pressable>
          </View>
        </View>
        <Text style={[styles.title, { color: colors.text }]}>肆度</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {mode === 'register' ? '好好好，又多了一位用户' : mode === 'forgot' ? '通过短信验证，重新设置密码' : '4°C，情绪的最佳保鲜温度'}
        </Text>

        <View style={[styles.inputRow, { borderBottomColor: colors.divider }]}>
          <Text style={[styles.prefix, { color: colors.text }]}>+86</Text>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="请输入手机号"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={11}
            value={phone}
            onChangeText={(t) => setPhone(t.replace(/\D/g, ''))}
          />
        </View>

        <View style={[styles.inputRow, { borderBottomColor: colors.divider }]}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder={mode === 'login' ? '请输入密码' : mode === 'forgot' ? '请设置新密码（至少10位）' : '请设置密码（至少10位）'}
            placeholderTextColor={colors.textMuted}
            secureTextEntry={!showPw}
            maxLength={30}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable onPress={() => setShowPw(!showPw)} hitSlop={8}>
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        {mode === 'register' && (
          <>
          <View style={[styles.inputRow, { borderBottomColor: colors.divider }]}>
            <Ionicons name="person-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="请输入昵称"
              placeholderTextColor={colors.textMuted}
              maxLength={12}
              value={nickname}
              onChangeText={setNickname}
            />
          </View>

          <Pressable style={[styles.inputRow, { borderBottomColor: colors.divider }]} onPress={pickAvatar}>
            <Ionicons name="camera-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <Text style={[styles.input, { color: avatarUri ? colors.text : colors.textMuted, lineHeight: 40 }]}>
              {avatarUri ? '已选择头像' : '上传头像'}
            </Text>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={{ width: 36, height: 36, borderRadius: 18 }} />
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            )}
          </Pressable>

          <View style={[styles.inputRow, { borderBottomWidth: 0 }]}>
            <Ionicons name="transgender-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <Text style={{ fontSize: 14, color: colors.textMuted, marginRight: 12 }}>性别（选定后不可修改）</Text>
            <Pressable
              style={[styles.genderDot, gender === 'male' && { backgroundColor: '#5BA0D9' }]}
              onPress={() => setGender(gender === 'male' ? '' : 'male')}
            >
              <GenderSymbol gender="male" color={gender === 'male' ? '#FFFFFF' : '#5BA0D9'} />
            </Pressable>
            <Pressable
              style={[styles.genderDot, gender === 'female' && { backgroundColor: '#F08CB4' }]}
              onPress={() => setGender(gender === 'female' ? '' : 'female')}
            >
              <GenderSymbol gender="female" color={gender === 'female' ? '#FFFFFF' : '#F08CB4'} />
            </Pressable>
          </View>

          <AgeWheelPicker
            value={age}
            onChange={setAge}
            onInteractionChange={setAgeWheelActive}
            palette={{ text: colors.text, textMuted: colors.textMuted, accent: colors.accent, divider: colors.divider }}
          />

          {/* 密保问题 */}
          <Pressable style={[styles.inputRow, { borderBottomWidth: 0 }]} onPress={() => setShowQPicker(!showQPicker)}>
            <Ionicons name="help-circle-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <Text style={[styles.input, { color: securityQ ? colors.text : colors.textMuted, lineHeight: 40 }]}>
              {securityQ || '请选择密保问题'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </Pressable>
          {showQPicker && (
            <View style={{ paddingHorizontal: 26, marginBottom: 8 }}>
              {SECURITY_QUESTIONS.map((q) => (
                <Pressable key={q} style={{ paddingVertical: 8 }} onPress={() => { setSecurityQ(q); setShowQPicker(false); if (q !== '自定义问题') setCustomQ(''); }}>
                  <Text style={{ color: securityQ === q ? colors.accent : colors.textMuted, fontSize: 14 }}>{q}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {securityQ === '自定义问题' && (
            <View style={[styles.inputRow, { marginTop: -4, borderBottomColor: colors.divider }]}>
              <TextInput style={[styles.input, { color: colors.text }]} placeholder="请输入你的密保问题" placeholderTextColor={colors.textMuted} value={customQ} onChangeText={setCustomQ} />
            </View>
          )}

          <View style={[styles.inputRow, { borderBottomColor: colors.divider }]}>
            <Ionicons name="key-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput style={[styles.input, { color: colors.text }]} placeholder="密保问题答案" placeholderTextColor={colors.textMuted} value={securityA} onChangeText={setSecurityA} />
          </View>

          </>
        )}

        {mode !== 'login' && (
          <View style={[styles.inputRow, { borderBottomColor: colors.divider }]}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="固定验证码 252616"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            />
            <Pressable disabled={!canSendCode || sending} onPress={handleSendCode}>
              <Text style={[styles.codeBtn, { color: colors.accent }, (!canSendCode || sending) && { color: colors.textMuted }]}>
                {sending ? '处理中...' : '填入验证码'}
              </Text>
            </Pressable>
          </View>
        )}

        {mode === 'register' && !canSubmit && !loading && (
          <Text style={[styles.error, { color: colors.textMuted }]}>
            {!phoneValid ? '· 请输入正确的手机号' :
             password.length < 10 ? '· 密码至少10位' :
             !nickname.trim() ? '· 请输入昵称' :
             !gender ? '· 请选择性别' :
             !avatarUri ? '· 请上传头像' :
             !securityQuestionValid ? (customSecurityQuestionSelected ? '· 请输入自定义密保问题' : '· 请选择密保问题') :
             !securityA.trim() ? '· 请输入密保答案' :
             code.length !== 6 ? '· 请输入固定验证码 252616' :
             !agreed ? '· 请同意用户协议' : ''}
          </Text>
        )}

        {mode === 'forgot' && !canSubmit && !loading && (
          <Text style={[styles.error, { color: colors.textMuted }]}>
            {!phoneValid ? '· 请输入正确的手机号' :
             password.length < 10 ? '· 新密码至少10位' :
             code.length !== 6 ? '· 请输入固定验证码 252616' :
             !agreed ? '· 请同意用户协议' : ''}
          </Text>
        )}

        {error !== '' && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.loginBtn, { backgroundColor: colors.accent }, (!canSubmit || loading) && { backgroundColor: colors.textMuted }]}
          disabled={!canSubmit || loading}
          onPress={handleSubmit}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginBtnText}>{mode === 'register' ? '注册' : mode === 'forgot' ? '重设密码' : '登录'}</Text>
          )}
        </Pressable>

        <Pressable style={styles.switchRow} onPress={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setPassword(''); setCode(''); setError('');
        }}>
          <Text style={[styles.switchText, { color: colors.accent }]}>
            {mode === 'login' ? '没有账号？点击注册' : mode === 'forgot' ? '返回登录' : '已有账号？点击登录'}
          </Text>
        </Pressable>

        {mode === 'login' && (
          <Pressable style={{ alignItems: 'center', marginTop: 8, marginBottom: 4 }} onPress={handleForgotPwStart}>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>忘记密码？</Text>
          </Pressable>
        )}

        <Pressable style={styles.agreeRow} onPress={() => setAgreed(!agreed)}>
          <Ionicons
            name={agreed ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={agreed ? colors.accent : colors.textMuted}
          />
          <Text style={[styles.agreeText, { color: colors.textMuted }]}>
            我已阅读并同意 <Text style={[styles.link, { color: colors.accent }]}>《用户协议》</Text>和
            <Text style={[styles.link, { color: colors.accent }]}>《隐私政策》</Text>
          </Text>
        </Pressable>
      </ScrollView>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 32, paddingTop: 90, paddingBottom: 40 },
  logo: {
    width: 88, height: 88, alignItems: 'center', justifyContent: 'center',
    borderRadius: 16,
  },
  logoRow: { minHeight: 88, alignItems: 'flex-start', justifyContent: 'center', marginBottom: 22, position: 'relative' },
  logoPressable: { width: 88, height: 88, marginLeft: -18 },
  logoImg: { width: 84, height: 84 },
  stardewLogoImg: { width: 64, height: 64 },
  stardewHint: {
    position: 'absolute',
    left: 92,
    right: 8,
    fontSize: Platform.OS === 'ios' ? 14 : 12,
    lineHeight: Platform.OS === 'ios' ? 22 : 19,
    fontWeight: '600',
  },
  themeButtonAnchor: { position: 'absolute', right: 0, width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  themeButton: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'left', fontSize: 24, fontWeight: '700', color: '#1A1D26' },
  subtitle: { fontSize: 13, color: '#6B7185', marginTop: 8, marginBottom: 36 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1,
    borderBottomColor: '#F2F3F7', paddingVertical: 14, marginBottom: 8,
  },
  prefix: { fontSize: 16, color: '#1A1D26', marginRight: 12, fontWeight: '500' },
  input: { flex: 1, fontSize: 16, color: '#1A1D26', padding: 0 },
  codeBtn: { fontSize: 14, color: '#33A9DC', fontWeight: '500' },
  error: { fontSize: 13, color: '#E24B4A', marginTop: 8 },
  loginBtn: {
    backgroundColor: '#33A9DC', borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginTop: 32,
  },
  loginBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  switchRow: { alignItems: 'center', marginTop: 16 },
  switchText: { fontSize: 14, color: '#33A9DC' },
  agreeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  agreeText: { fontSize: 12, color: '#6B7185', marginLeft: 6, flex: 1 },
  link: { color: '#33A9DC' },
  genderDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
});

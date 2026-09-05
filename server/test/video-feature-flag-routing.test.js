const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('standalone video flag is created disabled and gates every video write path', () => {
  const migrations = source('src/db/migrations.js');
  assert.match(migrations, /VALUES \('video_upload','普通视频',[\s\S]*?,0,0\)/);

  for (const route of ['src/routes/upload.js', 'src/routes/posts.js', 'src/routes/chat.js', 'src/routes/reef.js']) {
    assert.match(source(route), /isFeatureEnabled\('video_upload', req\.userId\)/, route);
  }
  assert.match(source('src/routes/upload.js'), /isLivePhotoMotion/);
  assert.doesNotMatch(source('src/routes/upload.js'), /router\.post\('\/motion-photo', auth, requireStandaloneVideo/);
  assert.match(source('src/routes/upload.js'), /router\.post\('\/', auth, gateVideoUpload/);
});

test('app hides standalone video entry points without hiding Live Photos', () => {
  const appRoot = path.join(__dirname, '..', '..', 'community-app', 'src', 'app');
  for (const relativePath of ['publish.tsx', path.join('chat', '[name].tsx'), path.join('reef', '[id].tsx')]) {
    const contents = fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
    assert.match(contents, /features\.video_upload === true/, relativePath);
    assert.match(contents, /videoUploadEnabled \? <Pressable|videoUploadEnabled && !videoUri/, relativePath);
    assert.match(contents, /mediaTypes: \['images', 'livePhotos'\]/, relativePath);
  }

  const publish = fs.readFileSync(path.join(appRoot, 'publish.tsx'), 'utf8');
  assert.match(publish, /accessibilityLabel="添加图片或实况照片"[\s\S]*?onPress=\{pickImages\}/);
  assert.doesNotMatch(publish, /pickAndroidMotionPhoto|accessibilityLabel="添加动态照片"/);
  assert.match(publish, /const motion = await uploadMotionPhoto\(asset\.uri, 'post'\)/);
  assert.match(publish, /previewUri: asset\.uri/);
  assert.match(publish, /uri: item\.previewUri \|\| item\.stillUri/);
  assert.match(publish, /setLivePhotos\(current => \[/);
  assert.match(publish, /code === 'NOT_MOTION_PHOTO'/);
  assert.doesNotMatch(publish, /uploadMotionPhoto[\s\S]{0,300}setVideoUri/);

  const client = fs.readFileSync(path.join(appRoot, '..', 'api', 'client.ts'), 'utf8');
  assert.match(client, /export async function uploadPairedLivePhoto/);
  assert.match(client, /livePhotoMotion: true/);
  for (const relativePath of [path.join('chat', '[name].tsx'), path.join('reef', '[id].tsx')]) {
    const contents = fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
    assert.match(contents, /uploadPairedLivePhoto\(/, relativePath);
    assert.match(contents, /if \(!isNotMotionPhotoError\(error\)\) throw error/, relativePath);
    assert.doesNotMatch(contents, /if \(media\.kind === 'android_motion'\) throw error/, relativePath);
  }
  const chat = fs.readFileSync(path.join(appRoot, 'chat', '[name].tsx'), 'utf8');
  assert.match(chat, /kind: Platform\.OS === 'android' \? 'android_motion_candidate' : 'image'/);
  assert.match(publish, /allowsMultipleSelection: Platform\.OS === 'android'/);
  assert.match(publish, /selectionLimit: Platform\.OS === 'android' \? remainingSlots : 1/);
  assert.match(chat, /allowsMultipleSelection: Platform\.OS === 'android'/);
  assert.match(chat, /selectionLimit: Platform\.OS === 'android' \? remaining : 1/);

  const upload = source('src/routes/upload.js');
  assert.match(upload, /code: 'NOT_MOTION_PHOTO'/);
  assert.match(upload, /code: 'MOTION_PHOTO_PROCESSING_FAILED'/);
  assert.doesNotMatch(upload, /res\.status\(error\.statusCode \|\| 500\)\.json\(\{ error: error\.message/);
});

test('mixed post photos share one grid based on their combined count', () => {
  const appRoot = path.join(__dirname, '..', '..', 'community-app', 'src');
  for (const relativePath of ['components/post-card.tsx', path.join('app', 'post', '[id].tsx')]) {
    const contents = fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
    assert.match(contents, /totalPhotoCount = [^;]*\.length \+ [^;]*\.length/, relativePath);
    assert.match(contents, /totalPhotoCount >= 2/, relativePath);
    assert.match(contents, /width=\{(?:imgSize|livePhotoSize)\} height=\{(?:imgSize|livePhotoSize)\}/, relativePath);
    assert.match(contents, /viewerMedia[\s\S]*?\.\.\.postLivePhotos|viewerMedia[\s\S]*?\.\.\.livePhotoList/, relativePath);
  }

  const liveViewer = fs.readFileSync(path.join(appRoot, 'components', 'live-photo.tsx'), 'utf8');
  assert.match(liveViewer, /type MediaViewerItem = \{ stillUrl: string; motionUrl\?: string \}/);
  assert.match(liveViewer, /item\.motionUrl \? <ZoomableLivePhoto[\s\S]*?: <ZoomableImage/);
});

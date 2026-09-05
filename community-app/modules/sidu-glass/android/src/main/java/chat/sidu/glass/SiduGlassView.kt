package chat.sidu.glass

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RectF
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.Window
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.max

@SuppressLint("ViewConstructor")
class SiduGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val density = resources.displayMetrics.density
  private val bounds = RectF()
  private val clipPath = Path()
  private val surfacePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
  }
  private val innerRimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
  }
  private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val backdropPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val backdropHandler = Handler(Looper.getMainLooper())
  private var backdropBitmap: Bitmap? = null
  private var backdropScratchBitmap: Bitmap? = null
  private var backdropRenderNode: RenderNode? = null
  private var backdropCopyPending = false
  // PixelCopy completes asynchronously. A size/theme change can invalidate a
  // request while RenderThread is still consuming the previous frame.
  private var backdropGeneration = 0L
  private var lastBackdropCopyAt = 0L
  private var backdropOffsetX = 0
  private var backdropOffsetY = 0
  private var backdropEnabled = false
  private val backdropTicker = object : Runnable {
    override fun run() {
      requestBackdropCopy()
      if (isAttachedToWindow) backdropHandler.postDelayed(this, BACKDROP_INTERVAL_MS)
    }
  }

  private var runtimeShader: RuntimeShader? = null

  var variant: String = "regular"
    set(value) {
      field = value
      invalidate()
    }

  var dark: Boolean = false
    set(value) {
      field = value
      invalidate()
    }

  var materialPressed: Boolean = false
    set(value) {
      field = value
      invalidate()
    }

  var cornerRadiusDp: Float = 20f
    set(value) {
      field = max(0f, value)
      invalidate()
    }

  var useBackdrop: Boolean = false
    set(value) {
      field = value
      backdropEnabled = value && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
      if (backdropEnabled && isAttachedToWindow) {
        backdropHandler.removeCallbacks(backdropTicker)
        backdropHandler.post(backdropTicker)
      } else if (!backdropEnabled) {
        backdropHandler.removeCallbacks(backdropTicker)
        clearBackdrop()
      }
      invalidate()
    }

  init {
    setWillNotDraw(false)
    setBackgroundColor(Color.TRANSPARENT)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      runtimeShader = runCatching { RuntimeShader(GLASS_SHADER) }.getOrNull()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (backdropEnabled) {
      backdropHandler.removeCallbacks(backdropTicker)
      backdropHandler.post(backdropTicker)
    }
  }

  override fun onDetachedFromWindow() {
    backdropHandler.removeCallbacks(backdropTicker)
    backdropCopyPending = false
    clearBackdrop()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w != oldw || h != oldh) clearBackdrop()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width <= 0 || height <= 0) return

    val inset = 0.75f * density
    bounds.set(inset, inset, width - inset, height - inset)
    val radius = cornerRadiusDp * density

    drawBackdrop(canvas, radius)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && runtimeShader != null) {
      drawShaderSurface(canvas, radius)
    } else {
      drawFallbackSurface(canvas, radius)
    }
    drawNativeRims(canvas, radius)
  }

  /** Draw a throttled snapshot of the window behind larger regular surfaces. */
  private fun drawBackdrop(canvas: Canvas, radius: Float) {
    if (!backdropEnabled || variant == "clear" || backdropBitmap == null || backdropRenderNode == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    canvas.save()
    clipPath.reset()
    clipPath.addRoundRect(bounds, radius, radius, Path.Direction.CW)
    canvas.clipPath(clipPath)
    canvas.translate(-backdropOffsetX.toFloat(), -backdropOffsetY.toFloat())
    canvas.scale(BACKDROP_SAMPLE_SCALE, BACKDROP_SAMPLE_SCALE)
    canvas.drawRenderNode(backdropRenderNode!!)
    canvas.restore()
  }

  private fun requestBackdropCopy() {
    if (!backdropEnabled || variant == "clear" || width < MIN_BACKDROP_WIDTH_PX || height < MIN_BACKDROP_HEIGHT_PX || !isShown || backdropCopyPending || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val now = android.os.SystemClock.uptimeMillis()
    if (now - lastBackdropCopyAt < BACKDROP_INTERVAL_MS - 10L) return
    val window = findWindow(context) ?: return
    // During navigation Android can detach the window surface before the view
    // receives onDetachedFromWindow(). PixelCopy throws synchronously when
    // there is no backing surface, so skip that frame and retry on the next
    // ticker instead of taking down the React host.
    if (!window.decorView.isAttachedToWindow || !window.decorView.isShown || !window.isActive) return
    val location = IntArray(2)
    getLocationInWindow(location)
    val inset = (BACKDROP_INSET_DP * density).toInt().coerceAtLeast(8)
    val windowWidth = window.decorView.width
    val windowHeight = window.decorView.height
    if (windowWidth <= 0 || windowHeight <= 0) return
    val left = (location[0] - inset).coerceAtLeast(0)
    val top = (location[1] - inset).coerceAtLeast(0)
    val right = (location[0] + width + inset).coerceAtMost(windowWidth)
    val bottom = (location[1] + height + inset).coerceAtMost(windowHeight)
    if (right <= left || bottom <= top) return
    val source = android.graphics.Rect(left, top, right, bottom)
    // The backdrop is blurred before it is shown, so a quarter-resolution
    // sample preserves the material while using roughly 1/16 of the memory.
    val sampleWidth = max(1, (source.width() / BACKDROP_SAMPLE_SCALE).toInt())
    val sampleHeight = max(1, (source.height() / BACKDROP_SAMPLE_SCALE).toInt())
    val target = backdropScratchBitmap?.takeIf { !it.isRecycled && it.width == sampleWidth && it.height == sampleHeight }
      ?: Bitmap.createBitmap(sampleWidth, sampleHeight, Bitmap.Config.ARGB_8888)
    val generation = backdropGeneration
    backdropCopyPending = true
    try {
      PixelCopy.request(window, source, target, { result ->
        if (generation == backdropGeneration) backdropCopyPending = false
        if (result == PixelCopy.SUCCESS && isAttachedToWindow && generation == backdropGeneration) {
          val previous = backdropBitmap
          backdropBitmap = target
          backdropScratchBitmap = previous
          backdropOffsetX = location[0] - left
          backdropOffsetY = location[1] - top
          updateBackdropRenderNode(target)
          lastBackdropCopyAt = android.os.SystemClock.uptimeMillis()
          postInvalidateOnAnimation()
        }
      }, backdropHandler)
    } catch (_: RuntimeException) {
      // The window surface may disappear between the checks above and the
      // request itself while a screen transition is being committed.
      backdropCopyPending = false
    }
  }

  private fun updateBackdropRenderNode(bitmap: Bitmap) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val node = backdropRenderNode ?: RenderNode("SiduGlassBackdrop").also { backdropRenderNode = it }
    node.setPosition(0, 0, bitmap.width, bitmap.height)
    // PixelCopy includes the surface's child text. Keep the sampled layer
    // subdued so that text does not become a bright blurred ghost.
    backdropPaint.alpha = BACKDROP_ALPHA
    val recording = node.beginRecording()
    recording.drawBitmap(bitmap, 0f, 0f, backdropPaint)
    node.endRecording()
    node.setRenderEffect(RenderEffect.createBlurEffect(BACKDROP_BLUR_DP * density / BACKDROP_SAMPLE_SCALE, BACKDROP_BLUR_DP * density / BACKDROP_SAMPLE_SCALE, Shader.TileMode.CLAMP))
  }

  private fun clearBackdrop() {
    backdropGeneration += 1
    backdropCopyPending = false
    // Do not call Bitmap.recycle() here. PixelCopy and RenderThread may still
    // hold native references for the current frame. Dropping our references
    // lets Android reclaim the sampled bitmaps safely after those users finish.
    backdropBitmap = null
    backdropScratchBitmap = null
    backdropRenderNode = null
    backdropOffsetX = 0
    backdropOffsetY = 0
  }

  private fun findWindow(context: Context): Window? {
    var current: Context? = context
    while (current is ContextWrapper) {
      if (current is Activity) return current.window
      current = current.baseContext
    }
    return null
  }

  private fun drawShaderSurface(canvas: Canvas, radius: Float) {
    val shader = runtimeShader ?: return
    shader.setFloatUniform("resolution", width.toFloat(), height.toFloat())
    shader.setFloatUniform("isDark", if (dark) 1f else 0f)
    shader.setFloatUniform("isClear", if (variant == "clear") 1f else 0f)
    shader.setFloatUniform("pressed", if (materialPressed) 1f else 0f)
    shader.setFloatUniform("touch", width * 0.5f, height * 0.42f)
    surfacePaint.shader = shader
    canvas.drawRoundRect(bounds, radius, radius, surfacePaint)
    surfacePaint.shader = null
  }

  private fun drawFallbackSurface(canvas: Canvas, radius: Float) {
    val isClear = variant == "clear"
    val topColor: Int
    val bottomColor: Int
    if (dark) {
      topColor = Color.argb(if (isClear) 36 else 72, 255, 255, 255)
      bottomColor = Color.argb(if (isClear) 20 else 48, 228, 234, 238)
    } else {
      topColor = Color.argb(if (isClear) 58 else 200, 255, 255, 255)
      bottomColor = Color.argb(if (isClear) 38 else 154, 235, 240, 243)
    }
    surfacePaint.shader = LinearGradient(
      0f,
      0f,
      width.toFloat(),
      height.toFloat(),
      intArrayOf(topColor, bottomColor),
      null,
      Shader.TileMode.CLAMP
    )
    canvas.drawRoundRect(bounds, radius, radius, surfacePaint)
    surfacePaint.shader = null

    if (materialPressed) {
      glowPaint.shader = RadialGradient(
        width * 0.5f,
        height * 0.42f,
        max(width, height) * 0.62f,
        if (dark) Color.argb(38, 255, 255, 255) else Color.argb(70, 255, 255, 255),
        Color.TRANSPARENT,
        Shader.TileMode.CLAMP
      )
      canvas.drawRoundRect(bounds, radius, radius, glowPaint)
      glowPaint.shader = null
    }
  }

  private fun drawNativeRims(canvas: Canvas, radius: Float) {
    val isClear = variant == "clear"
    if (isClear) return
    rimPaint.strokeWidth = 0.9f * density
    rimPaint.shader = LinearGradient(
      0f,
      0f,
      width.toFloat(),
      height.toFloat(),
      intArrayOf(
        if (dark) Color.argb(if (isClear) 30 else 72, 255, 255, 255) else Color.argb(if (isClear) 78 else 196, 255, 255, 255),
        if (dark) Color.argb(if (isClear) 10 else 18, 255, 255, 255) else Color.argb(if (isClear) 28 else 52, 132, 144, 151)
      ),
      null,
      Shader.TileMode.CLAMP
    )
    canvas.drawRoundRect(bounds, radius, radius, rimPaint)
    rimPaint.shader = null

    val innerInset = 1.55f * density
    val inner = RectF(bounds).apply { inset(innerInset, innerInset) }
    innerRimPaint.strokeWidth = 0.55f * density
    innerRimPaint.color = if (dark) Color.argb(if (isClear) 9 else 18, 255, 255, 255) else Color.argb(if (isClear) 30 else 60, 255, 255, 255)
    canvas.drawRoundRect(inner, max(0f, radius - innerInset), max(0f, radius - innerInset), innerRimPaint)
  }

  companion object {
    private const val BACKDROP_INTERVAL_MS = 240L
    private const val BACKDROP_SAMPLE_SCALE = 4f
    private const val BACKDROP_INSET_DP = 14f
    private const val BACKDROP_BLUR_DP = 5f
    private const val BACKDROP_ALPHA = 94
    private const val MIN_BACKDROP_WIDTH_PX = 180
    private const val MIN_BACKDROP_HEIGHT_PX = 42
    private const val GLASS_SHADER = """
      uniform float2 resolution;
      uniform float isDark;
      uniform float isClear;
      uniform float pressed;
      uniform float2 touch;

      half4 main(float2 point) {
        float2 safeSize = float2(max(resolution.x, 1.0), max(resolution.y, 1.0));
        float2 uv = point / safeSize;
        float edgeDistance = min(min(point.x, safeSize.x - point.x), min(point.y, safeSize.y - point.y));
        float outerRim = 1.0 - smoothstep(0.0, 1.8, edgeDistance);
        float innerRim = 1.0 - smoothstep(1.2, 5.2, edgeDistance);
        float topSheen = pow(max(0.0, 1.0 - uv.y), 4.0);
        float diagonalSheen = 1.0 - smoothstep(0.0, 0.62, abs((uv.x * 0.72 + uv.y * 0.28) - 0.28));
        float touchDistance = distance(point, touch) / max(safeSize.x, safeSize.y);
        float touchGlow = (1.0 - smoothstep(0.0, 0.56, touchDistance)) * pressed;

        float regularAlpha = mix(0.66, 0.28, isDark);
        float clearAlpha = mix(0.13, 0.085, isDark);
        float alpha = mix(regularAlpha, clearAlpha, isClear);
        alpha += outerRim * mix(0.13, 0.09, isDark) * (1.0 - isClear);
        alpha += touchGlow * 0.08;

        float3 lightBase = float3(0.955, 0.970, 0.978);
        float3 darkBase = float3(0.185, 0.195, 0.202);
        float3 color = mix(lightBase, darkBase, isDark);
        color += float3(1.0) * topSheen * mix(0.06, 0.035, isDark);
        color += float3(0.96, 0.985, 1.0) * diagonalSheen * 0.012;
        color += float3(1.0) * outerRim * mix(0.08, 0.05, isDark) * (1.0 - isClear);
        color += float3(1.0) * innerRim * 0.010 * (1.0 - isClear);
        color += float3(1.0) * touchGlow * mix(0.07, 0.05, isDark);

        float ripple = sin((uv.x * 17.0 + uv.y * 11.0) * 6.28318) * 0.002;
        color += float3(ripple);

        float composedAlpha = clamp(alpha, 0.0, 0.96);
        return half4(half3(color * composedAlpha), half(composedAlpha));
      }
    """
  }
}

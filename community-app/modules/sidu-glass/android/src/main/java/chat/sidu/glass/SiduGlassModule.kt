package chat.sidu.glass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SiduGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SiduGlass")

    View(SiduGlassView::class) {
      Name("SiduGlassSurface")

      Prop("variant") { view: SiduGlassView, value: String ->
        view.variant = value
      }

      Prop("dark") { view: SiduGlassView, value: Boolean ->
        view.dark = value
      }

      Prop("pressed") { view: SiduGlassView, value: Boolean ->
        view.materialPressed = value
      }

      Prop("cornerRadius") { view: SiduGlassView, value: Float ->
        view.cornerRadiusDp = value
      }

      Prop("useBackdrop") { view: SiduGlassView, value: Boolean ->
        view.useBackdrop = value
      }
    }
  }
}

package app.xvi.reader.ai

import android.content.Context
import android.content.Intent
import android.os.Build
import java.lang.ref.WeakReference
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ReaderAiExecutionModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ReaderAiExecution")
    Events("onStopAll")

    OnCreate {
      current = WeakReference(this@ReaderAiExecutionModule)
    }

    OnDestroy {
      if (current?.get() === this@ReaderAiExecutionModule) current = null
    }

    AsyncFunction("start") { activeCount: Int ->
      val intent = Intent(context, ReaderAiExecutionService::class.java)
        .setAction(ReaderAiExecutionService.ACTION_START)
        .putExtra(ReaderAiExecutionService.EXTRA_ACTIVE_COUNT, activeCount.coerceAtLeast(1))
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
      Unit
    }

    AsyncFunction("stop") {
      context.startService(
        Intent(context, ReaderAiExecutionService::class.java)
          .setAction(ReaderAiExecutionService.ACTION_SHUTDOWN),
      )
      Unit
    }

    AsyncFunction("notifyTaskResult") {
        taskId: String,
        targetId: String,
        title: String,
        succeeded: Boolean,
        appVisible: Boolean ->
      ReaderAiNotifications.notifyResult(
        context,
        taskId,
        targetId,
        title,
        succeeded,
        appVisible,
      )
    }

  }

  private fun notifyStopAll() {
    sendEvent("onStopAll")
  }

  companion object {
    private var current: WeakReference<ReaderAiExecutionModule>? = null

    internal fun emitStopAll() {
      current?.get()?.notifyStopAll()
    }
  }
}

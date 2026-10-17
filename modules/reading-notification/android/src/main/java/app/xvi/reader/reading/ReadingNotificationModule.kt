package app.xvi.reader.reading

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ReadingTimer : Record {
  @Field val bookId: String = ""
  @Field val title: String = ""
  /** Epoch milliseconds the timer started. */
  @Field val startedAt: Double = 0.0
}

/**
 * One ongoing notification per running reading timer. The system chronometer counts from the start
 * time, so the app does not need to run to keep it current. `sync` makes the shown notifications
 * match the running timers exactly; it is safe to call after every change.
 */
class ReadingNotificationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReadingNotification")

    AsyncFunction("requestPermission") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted(context) || permissions == null) {
        promise.resolve(granted(context))
        return@AsyncFunction
      }
      permissions.askForPermissions(
        { result: Map<String, PermissionsResponse> -> promise.resolve(result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED) },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }

    Function("sync") { timers: List<ReadingTimer> ->
      val context = appContext.reactContext ?: return@Function false
      val manager = context.getSystemService(NotificationManager::class.java) ?: return@Function false
      val keep = timers.map { it.bookId }.toSet()
      for (shown in manager.activeNotifications) {
        if (shown.tag?.startsWith(TAG_PREFIX) == true && shown.tag.removePrefix(TAG_PREFIX) !in keep) manager.cancel(shown.tag, NOTIFICATION_ID)
      }
      if (timers.isEmpty() || !granted(context)) return@Function false
      ensureChannel(manager)
      for (timer in timers) manager.notify(TAG_PREFIX + timer.bookId, NOTIFICATION_ID, notification(context, timer))
      true
    }
  }

  private fun granted(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun ensureChannel(manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "阅读计时", NotificationManager.IMPORTANCE_LOW).apply {
      description = "正在计时的书，提醒读完后结束计时"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun notification(context: Context, timer: ReadingTimer): Notification {
    @Suppress("DEPRECATION") // Channels exist from Android 8; older systems take the plain builder.
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL_ID) else Notification.Builder(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val open = launch?.let { PendingIntent.getActivity(context, timer.bookId.hashCode(), it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    return builder
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("《${timer.title.ifBlank { "这本书" }}》计时中")
      .setContentText("读完后回到「阅读」结束计时")
      .setWhen(timer.startedAt.toLong())
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setCategory(Notification.CATEGORY_STOPWATCH)
        if (open != null) setContentIntent(open)
      }
      .build()
  }

  private companion object {
    const val CHANNEL_ID = "reading-timer"
    const val TAG_PREFIX = "reading-timer:"
    const val NOTIFICATION_ID = 1
  }
}

package app.xvi.reader.ai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import app.xvi.reader.ai.R

internal object ReaderAiNotifications {
  const val RUNNING_CHANNEL_ID = "reader-ai-tasks"
  const val RESULT_CHANNEL_ID = "reader-ai-results"
  private const val RESULT_NOTIFICATION_ID = 4302

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannel(
      NotificationChannel(RUNNING_CHANNEL_ID, "AI 后台任务", NotificationManager.IMPORTANCE_LOW).apply {
        description = "显示正在后台完成的本地 AI 请求"
        setShowBadge(false)
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(RESULT_CHANNEL_ID, "AI 回复结果", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "显示 AI 回复完成或失败"
      },
    )
  }

  fun notificationsEnabled(context: Context): Boolean = try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() == true
    } else {
      true
    }
  } catch (_: RuntimeException) {
    false
  }

  fun channelEnabled(context: Context, channelId: String): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return notificationsEnabled(context)
    return try {
      context.getSystemService(NotificationManager::class.java)
        ?.getNotificationChannel(channelId)
        ?.importance != NotificationManager.IMPORTANCE_NONE
    } catch (_: RuntimeException) {
      false
    }
  }

  fun runningNotification(context: Context, activeCount: Int): Notification {
    ensureChannels(context)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, RUNNING_CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(context)
    }
    return builder
      .setSmallIcon(R.drawable.ic_reader_ai_status)
      .setContentTitle("阅读正在完成 AI 任务")
      .setContentText("${activeCount.coerceAtLeast(1)} 个任务正在运行")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setContentIntent(mainPendingIntent(context))
      .addAction(
        Notification.Action.Builder(
          null,
          "停止全部",
          PendingIntent.getService(
            context,
            1,
            Intent(context, ReaderAiExecutionService::class.java)
              .setAction(ReaderAiExecutionService.ACTION_STOP_ALL),
            PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
          ),
        ).build(),
      )
      .build()
  }

  fun notifyResult(
    context: Context,
    taskId: String,
    targetId: String,
    title: String,
    succeeded: Boolean,
    appVisible: Boolean,
  ): Boolean {
    if (appVisible) return false
    ensureChannels(context)
    if (!notificationsEnabled(context) || !channelEnabled(context, RESULT_CHANNEL_ID)) return false
    val displayTitle = title.trim().take(80).ifEmpty { "AI 回复" }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, RESULT_CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(context)
    }
    val notification = builder
      .setSmallIcon(R.drawable.ic_reader_ai_status)
      .setContentTitle(displayTitle)
      .setContentText(if (succeeded) "回复已完成" else "回复失败")
      .setCategory(Notification.CATEGORY_MESSAGE)
      .setAutoCancel(true)
      .setContentIntent(appPendingIntent(context, targetId, taskId, targetId.hashCode()))
      .build()
    return try {
      context.getSystemService(NotificationManager::class.java)
        ?.notify(targetId, RESULT_NOTIFICATION_ID, notification)
      true
    } catch (_: SecurityException) {
      false
    } catch (_: RuntimeException) {
      false
    }
  }

  private fun appPendingIntent(
    context: Context,
    targetId: String?,
    taskId: String?,
    requestCode: Int,
  ): PendingIntent {
    val uri = Uri.parse("xvi-reader:///").buildUpon()
      .apply {
        if (targetId != null) appendQueryParameter("targetId", targetId)
        if (taskId != null) appendQueryParameter("notificationId", taskId)
      }
      .build()
    val intent = Intent(Intent.ACTION_VIEW, uri)
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )
  }

  private fun mainPendingIntent(context: Context): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_VIEW, Uri.parse("xvi-reader:///assistant"))
    intent
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )
  }

  private fun immutableFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
}

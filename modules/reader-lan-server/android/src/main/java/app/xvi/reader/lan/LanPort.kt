package app.xvi.reader.lan

import java.net.BindException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

internal const val FIRST_LAN_PORT = 9527

/** The successful real listener is retained: no check-then-bind race or random port jump. */
internal suspend fun <T> bindFirstLanPort(bind: suspend (Int) -> T): T {
  for (port in FIRST_LAN_PORT..65535) {
    currentCoroutineContext().ensureActive()
    try { return bind(port) } catch (error: Exception) {
      if (generateSequence<Throwable>(error) { it.cause }.none { it is BindException }) throw error
    }
  }
  throw IllegalStateException("NO_AVAILABLE_PORT")
}

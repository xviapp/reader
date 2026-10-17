package app.xvi.reader.lan

import java.net.BindException
import java.net.ServerSocket
import java.net.InetAddress
import org.junit.Assert.*
import org.junit.Test
import kotlinx.coroutines.runBlocking

class LanPortTest {
  @Test fun occupiedPortsAreSkippedInOrderAndNextStartBeginsAtDefault(): Unit = runBlocking {
    val attempts = mutableListOf<Int>()
    val chosen = bindFirstLanPort { port ->
      attempts.add(port)
      if (port < 9529) throw BindException("occupied")
      port
    }
    assertEquals(listOf(9527, 9528, 9529), attempts)
    assertEquals(9529, chosen)
    assertEquals(9527, bindFirstLanPort { it })
  }
  @Test fun keepsTheActualListenerAndNeverSkipsNonBindFailures(): Unit = runBlocking {
    // A real JVM socket confirms the resource is returned while still bound.
    val socket = bindFirstLanPort { port -> ServerSocket(port, 1, InetAddress.getLoopbackAddress()) }
    try { assertTrue(socket.isBound); assertTrue(socket.localPort >= FIRST_LAN_PORT) } finally { socket.close() }
    var attempts = 0
    try {
      bindFirstLanPort<Unit> { attempts++; throw SecurityException("permission") }
      fail("Permission errors must not increment the port")
    } catch (_: SecurityException) { assertEquals(1, attempts) }
  }
}

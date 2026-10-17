package app.xvi.reader.lan

import org.junit.Assert.*
import org.junit.Test

class LanAccessTest {
  @Test fun codesSessionsAndRevocation() {
    val access = LanAccess { 0L }
    assertTrue(access.code.matches(Regex("[0-9]{6}")))
    val session = access.login("ip", access.code)
    assertEquals(64, session.length)
    val page = access.connect(session, "a".repeat(32))
    assertSame(page, access.requirePage(session, page.id))
    access.logout(session)
    failure("AUTH_REQUIRED") { access.session(session) }
    val fresh = access.login("ip", access.code)
    access.stop("event: service-stopping\ndata: {}\n\n")
    failure("AUTH_REQUIRED") { access.session(fresh) }
  }
  @Test fun replacementsAreGenerationSafeAndLeasesExpire() {
    var now = 0L
    val access = LanAccess { now }
    val session = access.login("ip", access.code)
    val old = access.connect(session, "a".repeat(32))
    val fresh = access.connect(session, old.id)
    access.disconnected(old)
    assertSame(fresh, access.requirePage(session, old.id))
    access.connect(session, "b".repeat(32)); access.connect(session, "c".repeat(32))
    failure("TOO_MANY_CLIENTS") { access.connect(session, "d".repeat(32)) }
    access.disconnected(fresh)
    now = 14_999; assertEquals(3, access.count())
    now = 15_000; assertEquals(2, access.count())
    access.connect(session, "d".repeat(32))
    val other = access.login("other-ip", access.code)
    failure("PAGE_NOT_CONNECTED") { access.requirePage(other, "d".repeat(32)) }
    failure("PAGE_NOT_CONNECTED") { access.connect(other, "d".repeat(32)) }
  }
  @Test fun badCodesAreLimitedByIpAndAcrossService() {
    var now = 0L
    val access = LanAccess { now }
    val wrong = if (access.code == "000000") "111111" else "000000"
    repeat(5) { failure("INVALID_CODE") { access.login("ip", wrong) } }
    failure("RATE_LIMITED") { access.login("ip", access.code) }
    now = 60_000
    assertNotNull(access.login("ip", access.code))
    repeat(30) { failure("INVALID_CODE") { access.login("address-$it", wrong) } }
    failure("RATE_LIMITED") { access.login("new-address", access.code) }
    now = 120_000
    assertNotNull(access.login("ip", access.code))
  }
  @Test fun slowPagesHaveABoundedQueue() {
    val page = LanPage("page", "session")
    repeat(128) { assertTrue(page.offer("small")) }
    assertFalse(page.offer("overflow"))
    val large = LanPage("large", "session")
    assertFalse(large.offer("a".repeat(1024 * 1024 + 1)))
  }
  private fun failure(code: String, action: () -> Unit) {
    try { action(); fail("Expected $code") } catch (error: LanFailure) { assertEquals(code, error.code) }
  }
}

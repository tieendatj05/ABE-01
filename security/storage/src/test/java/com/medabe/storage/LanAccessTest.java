package com.medabe.storage;
import static org.junit.jupiter.api.Assertions.*;
import com.medabe.storage.web.LanAccessFilter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
class LanAccessTest {
 @Test void rejectsExternalSocketEvenWhenForwardedHeaderClaimsLocal() throws Exception {
  var request = new MockHttpServletRequest(); request.setRemoteAddr("203.0.113.254"); request.addHeader("X-Forwarded-For", "127.0.0.1");
  var response = new MockHttpServletResponse();
  new LanAccessFilter().doFilter(request, response, (q,s) -> fail("external peer reached API"));
  assertEquals(403, response.getStatus());
 }
 @Test void acceptsLoopbackAndRejectsUnsupportedIPv6() {
  assertTrue(LanAccessFilter.isLanPeer("::ffff:127.0.0.1"));
  assertFalse(LanAccessFilter.isLanPeer("2001:db8::1"));
 }
}

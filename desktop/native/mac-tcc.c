#include <stdbool.h>
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <node_api.h>

static CFMachPortRef g_tap = NULL;
static CFRunLoopSourceRef g_source = NULL;

static CGEventRef host_tap_callback(
    CGEventTapProxy proxy,
    CGEventType type,
    CGEventRef event,
    void *userInfo
) {
  (void)proxy;
  (void)userInfo;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (g_tap) CGEventTapEnable(g_tap, true);
  }
  return event;
}

static bool install_host_input_monitoring(void) {
  // Creating a tap is what actually inserts the host app into
  // System Settings → Input Monitoring. The request call alone does not.
  (void)CGRequestListenEventAccess();

  if (g_tap != NULL) {
    CGEventTapEnable(g_tap, true);
    return CGPreflightListenEventAccess();
  }

  CGEventMask mask = CGEventMaskBit(kCGEventFlagsChanged) | CGEventMaskBit(kCGEventKeyDown);
  g_tap = CGEventTapCreate(
      kCGSessionEventTap,
      kCGHeadInsertEventTap,
      kCGEventTapOptionListenOnly,
      mask,
      host_tap_callback,
      NULL
  );
  if (g_tap == NULL) {
    g_tap = CGEventTapCreate(
        kCGHIDEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionListenOnly,
        mask,
        host_tap_callback,
        NULL
    );
  }
  if (g_tap == NULL) {
    return false;
  }

  g_source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
  if (g_source == NULL) {
    CFMachPortInvalidate(g_tap);
    CFRelease(g_tap);
    g_tap = NULL;
    return false;
  }

  CFRunLoopAddSource(CFRunLoopGetMain(), g_source, kCFRunLoopCommonModes);
  CGEventTapEnable(g_tap, true);
  return true;
}

static napi_value RequestListenEventAccess(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_get_boolean(env, install_host_input_monitoring(), &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, NULL, 0, RequestListenEventAccess, NULL, &fn);
  napi_set_named_property(env, exports, "requestListenEventAccess", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

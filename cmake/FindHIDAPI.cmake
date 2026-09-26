# - find HIDAPI
#
# Prefer HIDAPI's installed CMake package so static backend dependencies are
# carried by imported targets. Fall back to the historical raw-library lookup
# for system installations that do not ship a CMake config.

find_package(hidapi CONFIG QUIET)

if(TARGET hidapi::libusb)
  set(HIDAPI_FOUND TRUE)
  set(HIDAPI_LIBRARIES hidapi::libusb)
elseif(TARGET hidapi::winapi)
  set(HIDAPI_FOUND TRUE)
  set(HIDAPI_LIBRARIES hidapi::winapi)
elseif(TARGET hidapi::darwin)
  set(HIDAPI_FOUND TRUE)
  set(HIDAPI_LIBRARIES hidapi::darwin)
endif()

if(HIDAPI_FOUND)
  # HIDAPI's backend targets carry the public header directory transitively
  # through hidapi::include, rather than directly on each backend target.
  if(TARGET hidapi::include)
    get_target_property(HIDAPI_INCLUDE_DIRS
      hidapi::include INTERFACE_INCLUDE_DIRECTORIES)
  endif()

  if(HIDAPI_INCLUDE_DIRS AND
     NOT "${HIDAPI_INCLUDE_DIRS}" MATCHES "-NOTFOUND$")
    list(GET HIDAPI_INCLUDE_DIRS 0 HIDAPI_INCLUDE_DIR)
  endif()

  message(STATUS "HIDAPI CMake target: ${HIDAPI_LIBRARIES}")
  return()
endif()

find_library(HIDAPI_LIBRARY
  NAMES hidapi hidapi-libusb)

find_path(HIDAPI_INCLUDE_DIR
  NAMES hidapi.h
  PATH_SUFFIXES
  hidapi)

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(HIDAPI
  DEFAULT_MSG
  HIDAPI_LIBRARY
  HIDAPI_INCLUDE_DIR)

if(HIDAPI_FOUND)
  set(HIDAPI_LIBRARIES "${HIDAPI_LIBRARY}")

  # The Linux libusb backend depends on libusb, not libudev. HIDAPI 0.15's
  # deterministic Linux recipe disables the separate hidraw backend.
  if((STATIC AND UNIX AND NOT APPLE) OR (DEPENDS AND CMAKE_SYSTEM_NAME STREQUAL "Linux") OR ANDROID)
    find_library(LIBUSB-1.0_LIBRARY usb-1.0)
    if(LIBUSB-1.0_LIBRARY)
      set(HIDAPI_LIBRARIES "${HIDAPI_LIBRARIES};${LIBUSB-1.0_LIBRARY}")
    else()
      message(WARNING "libusb-1.0 library not found, binaries may fail to link.")
    endif()

    if(ANDROID)
      find_library(ANDROID_LOG_LIBRARY log)
      if(ANDROID_LOG_LIBRARY)
        set(HIDAPI_LIBRARIES "${HIDAPI_LIBRARIES};${ANDROID_LOG_LIBRARY}")
      else()
        message(WARNING "Android log library not found, binaries may fail to link.")
      endif()
    endif()
  endif()

  set(HIDAPI_INCLUDE_DIRS "${HIDAPI_INCLUDE_DIR}")
endif()

mark_as_advanced(HIDAPI_INCLUDE_DIR HIDAPI_LIBRARY)

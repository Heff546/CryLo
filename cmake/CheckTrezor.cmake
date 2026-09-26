OPTION(USE_DEVICE_TREZOR "Trezor support compilation" ON)
OPTION(USE_DEVICE_TREZOR_LIBUSB "Trezor LibUSB compilation" ON)
OPTION(USE_DEVICE_TREZOR_UDP_RELEASE "Trezor UdpTransport in release mode" OFF)
OPTION(USE_DEVICE_TREZOR_DEBUG "Trezor Debugging enabled" OFF)
OPTION(TREZOR_DEBUG "Main trezor debugging switch" OFF)

# Use Trezor master switch
if (USE_DEVICE_TREZOR)
    if(DEPENDS OR Protobuf_DIR)
        # Protobuf's config package owns the FindProtobuf-compatible variables
        # used below.  This must be a cache entry because protobuf declares it
        # with option(), and CMP0077 is not available at CryLo's CMake 3.12
        # minimum.
        set(protobuf_MODULE_COMPATIBLE ON CACHE BOOL
            "Populate FindProtobuf-compatible variables" FORCE)
        find_package(Protobuf CONFIG REQUIRED)
    else()
        find_package(Protobuf REQUIRED)
    endif()

    if(TARGET protobuf::libprotobuf)
        set(TREZOR_PROTOBUF_LIBRARIES protobuf::libprotobuf)
    elseif(Protobuf_LIBRARIES)
        set(TREZOR_PROTOBUF_LIBRARIES ${Protobuf_LIBRARIES})
    elseif(Protobuf_LIBRARY)
        set(TREZOR_PROTOBUF_LIBRARIES ${Protobuf_LIBRARY})
    endif()

    if(NOT Protobuf_INCLUDE_DIRS AND Protobuf_INCLUDE_DIR)
        set(Protobuf_INCLUDE_DIRS "${Protobuf_INCLUDE_DIR}")
    endif()

    if(Protobuf_INCLUDE_DIRS)
        list(GET Protobuf_INCLUDE_DIRS 0 TREZOR_PROTOBUF_INCLUDE_DIR)
    endif()

    if(NOT TREZOR_PROTOBUF_LIBRARIES)
        message(FATAL_ERROR "Trezor support requires the Protobuf C++ runtime")
    elseif(NOT Protobuf_PROTOC_EXECUTABLE OR NOT EXISTS "${Protobuf_PROTOC_EXECUTABLE}")
        message(FATAL_ERROR "Trezor support requires a native protoc executable: ${Protobuf_PROTOC_EXECUTABLE}")
    elseif(NOT TREZOR_PROTOBUF_INCLUDE_DIR OR NOT EXISTS "${TREZOR_PROTOBUF_INCLUDE_DIR}")
        message(FATAL_ERROR "Trezor support requires Protobuf headers: ${TREZOR_PROTOBUF_INCLUDE_DIR}")
    endif()

    message(STATUS
        "Trezor Protobuf ${Protobuf_VERSION}: "
        "libs=${TREZOR_PROTOBUF_LIBRARIES}, "
        "inc=${TREZOR_PROTOBUF_INCLUDE_DIR}, "
        "protoc=${Protobuf_PROTOC_EXECUTABLE}")

    if(TREZOR_DEBUG)
        set(USE_DEVICE_TREZOR_DEBUG 1)
    endif()

    if (USE_DEVICE_TREZOR_DEBUG)
        add_definitions(-DWITH_TREZOR_DEBUGGING=1)
    endif()
else()
    message(STATUS "Trezor support disabled by USE_DEVICE_TREZOR")
endif()

if(Protobuf_FOUND AND USE_DEVICE_TREZOR)
    if (NOT "$ENV{TREZOR_PYTHON}" STREQUAL "")
        set(TREZOR_PYTHON "$ENV{TREZOR_PYTHON}" CACHE INTERNAL "Copied from environment variable TREZOR_PYTHON")
    else()
        find_package(Python QUIET COMPONENTS Interpreter)  # cmake 3.12+
        if(Python_Interpreter_FOUND)
            set(TREZOR_PYTHON "${Python_EXECUTABLE}")
        endif()
    endif()

    if(NOT TREZOR_PYTHON)
        message(FATAL_ERROR "Trezor support requires a Python interpreter")
    endif()
endif()

# Protobuf generation + compile/link test.
if(Protobuf_FOUND AND USE_DEVICE_TREZOR AND TREZOR_PYTHON)
    execute_process(
        COMMAND ${Protobuf_PROTOC_EXECUTABLE}
            -I "${CMAKE_CURRENT_LIST_DIR}"
            -I "${TREZOR_PROTOBUF_INCLUDE_DIR}"
            "${CMAKE_CURRENT_LIST_DIR}/test-protobuf.proto"
            --cpp_out "${CMAKE_BINARY_DIR}"
        RESULT_VARIABLE RET
        OUTPUT_VARIABLE OUT
        ERROR_VARIABLE ERR)

    if(RET)
        message(FATAL_ERROR "Protobuf test generation failed: ${OUT} ${ERR}")
    endif()

    try_compile(Protobuf_COMPILE_TEST_PASSED
        "${CMAKE_BINARY_DIR}"
        SOURCES
        "${CMAKE_BINARY_DIR}/test-protobuf.pb.cc"
        "${CMAKE_CURRENT_LIST_DIR}/test-protobuf.cpp"
        CMAKE_FLAGS
        "-DINCLUDE_DIRECTORIES=${TREZOR_PROTOBUF_INCLUDE_DIR};${CMAKE_BINARY_DIR}"
        "-DCMAKE_CXX_STANDARD=17"
        LINK_LIBRARIES ${TREZOR_PROTOBUF_LIBRARIES}
        OUTPUT_VARIABLE OUTPUT
    )

    if(NOT Protobuf_COMPILE_TEST_PASSED)
        message(FATAL_ERROR "Protobuf Compilation test failed: ${OUTPUT}.")
    endif()
endif()

# Generate Trezor protobuf messages in the build tree. Configure must not
# rewrite tracked generated sources under src/device_trezor/trezor/messages.
if(Protobuf_FOUND AND USE_DEVICE_TREZOR AND TREZOR_PYTHON AND Protobuf_COMPILE_TEST_PASSED)
    set(TREZOR_PROTOBUF_GENERATED_ROOT "${CMAKE_BINARY_DIR}/generated")
    set(TREZOR_PROTOBUF_OUT_DIR "${TREZOR_PROTOBUF_GENERATED_ROOT}/trezor/messages")
    file(MAKE_DIRECTORY "${TREZOR_PROTOBUF_OUT_DIR}")

    set(ENV{PROTOBUF_INCLUDE_DIRS} "${TREZOR_PROTOBUF_INCLUDE_DIR}")
    set(ENV{PROTOBUF_PROTOC_EXECUTABLE} "${Protobuf_PROTOC_EXECUTABLE}")
    set(ENV{TREZOR_PROTOBUF_OUT_DIR} "${TREZOR_PROTOBUF_OUT_DIR}")

    set(TREZOR_PROTOBUF_PARAMS "")
    if (USE_DEVICE_TREZOR_DEBUG)
        set(TREZOR_PROTOBUF_PARAMS "--debug-msg")
    endif()
    
    execute_process(COMMAND ${TREZOR_PYTHON} tools/build_protob.py ${TREZOR_PROTOBUF_PARAMS} WORKING_DIRECTORY ${CMAKE_CURRENT_LIST_DIR}/../src/device_trezor/trezor RESULT_VARIABLE RET OUTPUT_VARIABLE OUT ERROR_VARIABLE ERR)
    if(RET)
        message(FATAL_ERROR "Trezor protobuf messages could not be regenerated (err=${RET}, python ${TREZOR_PYTHON})."
                "OUT: ${OUT}, ERR: ${ERR}."
                "Please read src/device_trezor/trezor/tools/README.md")
    else()
        message(STATUS "Trezor protobuf messages regenerated out: \"${OUT}.\"")
        # Protobuf generates deprecated enum aliases that trigger warnings
        # merely by including the generated headers. Keep those generated
        # compatibility aliases from polluting CryLo release builds.
        set(_deprecated_enum_files
                "messages-common.pb.h"
                "messages-management.pb.h"
        )

        foreach(file IN LISTS _deprecated_enum_files)
            file(READ "${TREZOR_PROTOBUF_OUT_DIR}/${file}" file_content)

            string(REPLACE "PROTOBUF_DEPRECATED_ENUM" ""
                    updated_content "${file_content}")

            string(PREPEND updated_content
                    "#if defined(__GNUC__)\n"
                    "#pragma GCC diagnostic push\n"
                    "#pragma GCC diagnostic ignored \"-Wdeprecated-declarations\"\n"
                    "#endif\n")

            string(APPEND updated_content
                    "#if defined(__GNUC__)\n"
                    "#pragma GCC diagnostic pop\n"
                    "#endif\n")

            file(WRITE
                    "${TREZOR_PROTOBUF_OUT_DIR}/${file}"
                    "${updated_content}")
        endforeach()

        set(DEVICE_TREZOR_READY 1)
        add_definitions(-DDEVICE_TREZOR_READY=1)

        if(CMAKE_BUILD_TYPE STREQUAL "Debug")
            add_definitions(-DTREZOR_DEBUG=1)
        endif()

        if(USE_DEVICE_TREZOR_UDP_RELEASE)
            add_definitions(-DUSE_DEVICE_TREZOR_UDP_RELEASE=1)
        endif()

        if (Protobuf_INCLUDE_DIRS)
            include_directories(${Protobuf_INCLUDE_DIRS})
        endif()
        include_directories("${TREZOR_PROTOBUF_GENERATED_ROOT}")

        # LibUSB support, check for particular version
        # Include support only if compilation test passes
        if (USE_DEVICE_TREZOR_LIBUSB)
            find_package(LibUSB REQUIRED)
        endif()

        if (LibUSB_COMPILE_TEST_PASSED)
            add_definitions(-DHAVE_TREZOR_LIBUSB=1)
            if(LibUSB_INCLUDE_DIRS)
                include_directories(${LibUSB_INCLUDE_DIRS})
            endif()
        elseif(USE_DEVICE_TREZOR_LIBUSB)
            message(FATAL_ERROR "Trezor LibUSB support was requested but the LibUSB compile test failed")
        endif()

        set(TREZOR_LIBUSB_LIBRARIES "")
        if(LibUSB_COMPILE_TEST_PASSED)
            list(APPEND TREZOR_LIBUSB_LIBRARIES ${LibUSB_LIBRARIES} ${LIBUSB_DEP_LINKER})
            message(STATUS "Trezor compatible LibUSB found at: ${LibUSB_INCLUDE_DIRS}")
        endif()

        if (BUILD_GUI_DEPS)
            set(TREZOR_DEP_LIBS "")
            set(TREZOR_DEP_LINKER "")

            if (TREZOR_PROTOBUF_LIBRARIES)
                list(APPEND TREZOR_DEP_LIBS ${TREZOR_PROTOBUF_LIBRARIES})
                string(APPEND TREZOR_DEP_LINKER " -lprotobuf")
            endif()

            if (TREZOR_LIBUSB_LIBRARIES)
                list(APPEND TREZOR_DEP_LIBS ${TREZOR_LIBUSB_LIBRARIES})
                string(APPEND TREZOR_DEP_LINKER " -lusb-1.0 ${LIBUSB_DEP_LINKER}")
            endif()
        endif()
    endif()
endif()

if(USE_DEVICE_TREZOR AND NOT DEVICE_TREZOR_READY)
    message(FATAL_ERROR "Trezor support was requested but the Trezor build prerequisites were not satisfied")
endif()

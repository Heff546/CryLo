package=native_abseil
$(package)_version=20250512.1
$(package)_download_path=https://github.com/abseil/abseil-cpp/releases/download/$($(package)_version)
$(package)_file_name=abseil-cpp-$($(package)_version).tar.gz
$(package)_sha256_hash=9b7a064305e9fd94d124ffa6cc358592eb42b5da588fb4e07d09254aa40086db
$(package)_cxxflags=-std=c++17

define $(package)_set_vars
  $(package)_config_opts=-DCMAKE_BUILD_TYPE=Release
  $(package)_config_opts+=-DCMAKE_INSTALL_LIBDIR=lib
  $(package)_config_opts+=-DCMAKE_POSITION_INDEPENDENT_CODE=ON
  $(package)_config_opts+=-DBUILD_SHARED_LIBS=OFF
  $(package)_config_opts+=-DBUILD_TESTING=OFF
  $(package)_config_opts+=-DABSL_BUILD_TESTING=OFF
  $(package)_config_opts+=-DABSL_BUILD_TEST_HELPERS=OFF
  $(package)_config_opts+=-DABSL_ENABLE_INSTALL=ON
  $(package)_config_opts+=-DABSL_PROPAGATE_CXX_STD=ON
endef

define $(package)_config_cmds
  CC="$($(package)_cc)" CXX="$($(package)_cxx)" \
  CFLAGS="$($(package)_cflags) $($(package)_cppflags)" \
  CXXFLAGS="$($(package)_cxxflags) $($(package)_cppflags)" \
  LDFLAGS="$($(package)_ldflags)" \
  cmake -S . -B build \
    -DCMAKE_INSTALL_PREFIX=$(build_prefix) \
    $($(package)_config_opts)
endef

define $(package)_build_cmds
  cmake --build build --parallel 2
endef

define $(package)_stage_cmds
  DESTDIR=$($(package)_staging_dir) cmake --install build
endef

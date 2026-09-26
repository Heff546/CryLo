package=native_protobuf
$(package)_version=36.2
$(package)_download_path=https://github.com/protocolbuffers/protobuf/releases/download/v$($(package)_version)
$(package)_file_name=protobuf-$($(package)_version).tar.gz
$(package)_sha256_hash=3d9642a662d10e68ebae5e53f14dcce5105684212d5078f8e0d47d1ab3ae6b64
$(package)_dependencies=native_abseil
$(package)_cxxflags=-std=c++17

define $(package)_set_vars
  $(package)_config_opts=-DCMAKE_BUILD_TYPE=Release
  $(package)_config_opts+=-DCMAKE_INSTALL_LIBDIR=lib
  $(package)_config_opts+=-DCMAKE_POSITION_INDEPENDENT_CODE=ON
  $(package)_config_opts+=-DCMAKE_PREFIX_PATH=$(build_prefix)
  $(package)_config_opts+=-Dabsl_DIR=$(build_prefix)/lib/cmake/absl
  $(package)_config_opts+=-Dprotobuf_LOCAL_DEPENDENCIES_ONLY=ON
  $(package)_config_opts+=-Dprotobuf_FORCE_FETCH_DEPENDENCIES=OFF
  $(package)_config_opts+=-Dprotobuf_WITH_ZLIB=OFF
  $(package)_config_opts+=-Dprotobuf_BUILD_TESTS=OFF
  $(package)_config_opts+=-Dprotobuf_BUILD_CONFORMANCE=OFF
  $(package)_config_opts+=-Dprotobuf_BUILD_EXAMPLES=OFF
  $(package)_config_opts+=-Dprotobuf_BUILD_SHARED_LIBS=OFF
  $(package)_config_opts+=-Dprotobuf_BUILD_PROTOBUF_BINARIES=ON
  $(package)_config_opts+=-Dprotobuf_BUILD_PROTOC_BINARIES=ON
  $(package)_config_opts+=-Dprotobuf_BUILD_LIBPROTOBUF=ON
  $(package)_config_opts+=-Dprotobuf_BUILD_LIBPROTOC=ON
  $(package)_config_opts+=-Dprotobuf_BUILD_LIBUPB=ON
  $(package)_config_opts+=-Dprotobuf_INSTALL=ON
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

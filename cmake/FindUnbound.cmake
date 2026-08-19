# Copyright (c) 2014-2022, The Monero Project
# All rights reserved.
# 
# Redistribution and use in source and binary forms, with or without modification, are
# permitted provided that the following conditions are met:
# 
# 1. Redistributions of source code must retain the above copyright notice, this list of
#    conditions and the following disclaimer.
# 
# 2. Redistributions in binary form must reproduce the above copyright notice, this list
#    of conditions and the following disclaimer in the documentation and/or other
#    materials provided with the distribution.
# 
# 3. Neither the name of the copyright holder nor the names of its contributors may be
#    used to endorse or promote products derived from this software without specific
#    prior written permission.
# 
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
# EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
# MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
# THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
# SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
# PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
# STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
# THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

MESSAGE(STATUS "Looking for libunbound")

FIND_PATH(UNBOUND_INCLUDE_DIR
  NAMES unbound.h
  PATH_SUFFIXES include/ include/unbound/
  PATHS "${PROJECT_SOURCE_DIR}"
  ${UNBOUND_ROOT}
  $ENV{UNBOUND_ROOT}
  /usr/local/
  /usr/
)

find_library(UNBOUND_LIBRARY unbound)

set(UNBOUND_LIBRARIES ${UNBOUND_LIBRARY})

# Static libunbound builds require their transitive dependencies to be
# linked explicitly because archive files do not propagate them.
if(UNBOUND_LIBRARY MATCHES "\\.a$")
  find_library(UNBOUND_EVENT_LIBRARY event)
  find_library(UNBOUND_HOGWEED_LIBRARY hogweed)
  find_library(UNBOUND_NETTLE_LIBRARY nettle)
  find_library(UNBOUND_GMP_LIBRARY gmp)

  if(UNBOUND_EVENT_LIBRARY)
    list(APPEND UNBOUND_LIBRARIES ${UNBOUND_EVENT_LIBRARY})
    message(STATUS "Static libunbound requires libevent: ${UNBOUND_EVENT_LIBRARY}")
  endif()

  if(UNBOUND_HOGWEED_LIBRARY)
    list(APPEND UNBOUND_LIBRARIES ${UNBOUND_HOGWEED_LIBRARY})
    message(STATUS "Static libunbound requires hogweed: ${UNBOUND_HOGWEED_LIBRARY}")
  endif()

  if(UNBOUND_NETTLE_LIBRARY)
    list(APPEND UNBOUND_LIBRARIES ${UNBOUND_NETTLE_LIBRARY})
    message(STATUS "Static libunbound requires nettle: ${UNBOUND_NETTLE_LIBRARY}")
  endif()

  if(UNBOUND_GMP_LIBRARY)
    list(APPEND UNBOUND_LIBRARIES ${UNBOUND_GMP_LIBRARY})
    message(STATUS "Static libunbound requires GMP: ${UNBOUND_GMP_LIBRARY}")
  endif()
endif()

set(
  UNBOUND_LIBRARIES
  "${UNBOUND_LIBRARIES}"
  CACHE STRING "Libraries required to link libunbound"
  FORCE
)

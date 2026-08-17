# Anonymity Networks with CryLo

CryLo supports Tor and I2P for selected peer-to-peer and transaction-broadcast activity.

These anonymity-network features are inherited from the underlying CryptoNote networking stack and should be considered advanced functionality.

## Behavior

When an anonymity network is enabled, locally created transactions can be routed through the configured anonymity network instead of being broadcast directly over the public P2P network.

If an anonymity network is enabled but no suitable anonymity-network peer is available, the transaction may remain pending for later broadcast rather than being immediately sent over the public network.

CryLo wallets may also connect to a CryLo daemon through a SOCKS proxy.

The daemon RPC hidden service is separate from any hidden service used for P2P connections.

## P2P Commands

Only selected P2P traffic is supported over anonymity networks.

The primary CryLo daemon options are:

```text
--tx-proxy
--anonymous-inbound
```

The current source accepts transaction proxy configuration in this form:

```text
--tx-proxy <network-type>,<socks-ip:port>[,max_connections][,disable_noise]
```

Example:

```text
--tx-proxy tor,127.0.0.1:9050,10
```

For I2P:

```text
--tx-proxy i2p,127.0.0.1:9000
```

The current CryLo implementation supports Tor and I2P network types for anonymity-network routing.

## Outbound Connections

Connecting to anonymous peers requires `--tx-proxy`.

Example Tor configuration:

```text
CryLo-daemon \
  --tx-proxy tor,127.0.0.1:9050,10
```

Example I2P configuration:

```text
CryLo-daemon \
  --tx-proxy i2p,127.0.0.1:9000
```

Multiple `--tx-proxy` options may be configured when using more than one anonymity network.

Peer addresses may also be specified manually with normal CryLo peer options such as:

```text
--add-exclusive-node
--add-peer
```

Using exclusive peers can prevent normal seed-node discovery and should therefore be used deliberately.

## Inbound Connections

CryLo supports anonymous inbound P2P connections through:

```text
--anonymous-inbound <hidden-service-address>,<[bind-ip:]port>[,max_connections]
```

Example:

```text
--anonymous-inbound example.onion,127.0.0.1:22640,25
```

The CryLo source requires an appropriate `--tx-proxy` configuration when anonymous inbound networking is configured, because locally created transactions still require an anonymity-network route for outbound transmission.

The default CryLo P2P port is `22640`.

## Wallet RPC Through Tor or I2P

A Tor or I2P hidden service may also forward connections to the CryLo daemon RPC interface.

The default CryLo RPC port is `22641`.

For example, a Tor hidden service may forward an onion service to:

```text
127.0.0.1:22641
```

The wallet can then connect through a SOCKS proxy:

```text
CryLo-wallet \
  --proxy 127.0.0.1:9050 \
  --daemon-address <hidden-service-address>:22641
```

For wallet RPC operation, use the corresponding `CryLo-wallet-rpc` executable.

## CryLo Network Ports

Current default CryLo ports are:

| Service | Port |
| --- | ---: |
| P2P | 22640 |
| RPC | 22641 |
| ZMQ RPC | 22642 |

These values are defined by the current CryLo network configuration.

## Tor Hidden-Service Example

A minimal Tor hidden-service configuration for CryLo P2P may resemble:

```text
HiddenServiceDir /var/lib/tor/data/crylo
HiddenServicePort 22640 127.0.0.1:22640
```

A separate hidden service can be configured for daemon RPC if required:

```text
HiddenServiceDir /var/lib/tor/data/crylo-rpc
HiddenServicePort 22641 127.0.0.1:22641
```

The generated hidden-service hostname can then be supplied to CryLo through `--anonymous-inbound`, peer options, or wallet daemon configuration as appropriate.

## I2P

I2P may be configured with a suitable SOCKS proxy and server tunnel.

The exact I2P tunnel configuration depends on the I2P implementation in use.

Example CryLo daemon proxy configuration:

```text
CryLo-daemon \
  --tx-proxy i2p,127.0.0.1:9000
```

## Privacy Limitations

Anonymity networks improve resistance to direct network-level observation but do not guarantee complete anonymity.

Potential information leaks can include timing correlation, peer behavior, connection reuse, traffic analysis, and other metadata.

Users relying on Tor or I2P should understand the limitations of the anonymity network itself as well as the CryLo networking behavior layered on top of it.

Keeping the system clock accurate can reduce some forms of timing fingerprinting.

Running the CryLo daemon consistently rather than only when sending transactions can also reduce obvious timing correlation between local network activity and transaction broadcast.

## Operational Notes

CryLo's anonymity-network implementation is advanced functionality.

Before exposing a daemon RPC interface through Tor or I2P:

- keep the RPC interface authenticated where appropriate
- avoid exposing unrestricted administrative RPC access
- verify the hidden service forwards only the intended local port
- confirm the wallet is using the expected SOCKS proxy
- verify the configured hidden-service address before relying on it

For public CryLo networking, normal daemon-to-daemon P2P connectivity remains the standard configuration.

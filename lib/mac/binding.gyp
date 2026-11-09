{
  'variables': {
    'openssl_fips' : '',
    # The CoreBluetooth core. Compiled by build-swift.sh, not by gyp itself.
    'swift_sources': [
      'src/AddressBook.swift',
      'src/BLEManager.swift',
      'src/Exports.swift',
      'src/JSChannel.swift',
      'src/Marshalling.swift',
      'src/PeripheralSession.swift',
    ],
    'swift_core_library': '<(INTERMEDIATE_DIR)/libNobleMacCore.a',
  },
  'targets': [
    {
      'target_name': 'binding',
      'sources': [
        'src/noble_mac.cc',
      ],
      'include_dirs': [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        '../common/include',
        'src',
      ],
      'cflags!': [ '-fno-exceptions' ],
      'cflags_cc!': [ '-fno-exceptions' ],
      'defines': [ 'NAPI_CPP_EXCEPTIONS' ],
      'actions': [
        {
          # Swift sources -> universal static library, linked below by path.
          'action_name': 'build_swift_core',
          'message': 'Compiling the Swift CoreBluetooth core',
          'inputs': [
            'build-swift.sh',
            'src/noble_mac_bridge.h',
            '<@(swift_sources)',
          ],
          'outputs': [
            '<(swift_core_library)',
          ],
          'action': [
            'sh',
            'build-swift.sh',
            '<(swift_core_library)',
            'src/noble_mac_bridge.h',
            '<@(swift_sources)',
          ],
        },
      ],
      'xcode_settings': {
        'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
        'MACOSX_DEPLOYMENT_TARGET': '11',
        'CLANG_CXX_LIBRARY': 'libc++',
        'OTHER_CFLAGS': [
          '-arch x86_64',
          '-arch arm64'
        ],
        'OTHER_LDFLAGS': [
          '<(swift_core_library)',
          # Where the Swift runtime is found at link time (toolchain + SDK) ...
          '<!@(sh build-swift.sh --ldflags)',
          '-L/usr/lib/swift',
          # ... and at run time: it ships with macOS.
          '-Wl,-rpath,/usr/lib/swift',
          # Swift auto-links every library its imports mention; only keep the
          # ones that are really used so nothing newer than macOS 11 is required.
          '-Wl,-dead_strip_dylibs',
          '-framework CoreBluetooth',
          '-framework Foundation',
          '-arch x86_64',
          '-arch arm64'
        ]
      }
    }
  ]
}

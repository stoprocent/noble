{
  'variables': {
    'openssl_fips' : '' 
  },
  'targets': [
    {
      'target_name': 'binding',
      'sources': [ 
        "<!@(node -p \"require('fs').readdirSync('src').filter(f=>new RegExp('.*\\\\.(c|cc|cpp)$').test(f)).map(f=>'src/'+f).join(' ')\")",
        "<!@(node -p \"require('fs').readdirSync('../common/src').filter(f=>new RegExp('.*\\\\.(c|cc|cpp)$').test(f)).map(f=>'../common/src/'+f).join(' ')\")"
      ],
      'include_dirs': [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "../common/include"
      ],
      'cflags!': [ '-fno-exceptions' ],
      'cflags_cc!': [ '-fno-exceptions' ],
      'msvs_settings': {
        'VCCLCompilerTool': {
          'ExceptionHandling': 1,
          'AdditionalOptions': [
            '/await', 
            '/std:c++20'
          ],
        },
      },
      'msvs_target_platform_version':'10.0.18362.0',
      'msvs_target_platform_minversion':'10.0.18362.0',
      'conditions': [
        ['OS=="win"', { 
          'defines': [ '_HAS_EXCEPTIONS=1', 'NAPI_CPP_EXCEPTIONS' ] 
        }]
      ],
    }
  ]
}

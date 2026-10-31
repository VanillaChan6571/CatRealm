Pod::Spec.new do |s|
  s.name = 'CatRealmNotificationDiagnostics'
  s.version = '1.0.0'
  s.summary = 'CatRealm notification preview diagnostics'
  s.description = s.summary
  s.license = 'AGPL-3.0-or-later'
  s.author = 'CatRealm'
  s.homepage = 'https://catrealm.app'
  s.source = { :git => 'https://github.com/VanillaChan6571/CatRealmPrivate.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end

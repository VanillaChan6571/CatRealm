#import "NotificationService.h"
#import <Intents/Intents.h>
#import "NotificationServiceExtension-Swift.h"

@interface NotificationService ()

@property (nonatomic, strong) void (^contentHandler)(UNNotificationContent *contentToDeliver);
@property (nonatomic, strong) UNMutableNotificationContent *bestAttemptContent;
@property (nonatomic, strong) NSURLSessionDataTask *attachmentTask;
@property (nonatomic, assign) BOOL didFinish;

@end

@implementation NotificationService

- (void)didReceiveNotificationRequest:(UNNotificationRequest *)request withContentHandler:(void (^)(UNNotificationContent * _Nonnull))contentHandler {
  self.contentHandler = contentHandler;
  self.bestAttemptContent = [request.content mutableCopy];
  [self writeDiagnosticWithStatus:@"started" details:@{
    @"hasEnvelope": @([self stringValueFromUserInfo:self.bestAttemptContent.userInfo keys:@[@"encryptedPreviewEnvelope"]].length > 0),
    @"hasAvatarUrl": @([self imageUrlStringFromUserInfo:self.bestAttemptContent.userInfo].length > 0),
  }];
  [self hydrateEncryptedPreviewIfAvailable];

  NSString *imageUrlString = [self imageUrlStringFromUserInfo:request.content.userInfo];
  if (imageUrlString.length == 0) {
    [self deliverCommunicationContentWithAvatarData:nil];
    return;
  }

  NSURL *imageUrl = [NSURL URLWithString:imageUrlString];
  if (!imageUrl || ![imageUrl.scheme.lowercaseString hasPrefix:@"http"]) {
    [self deliverCommunicationContentWithAvatarData:nil];
    return;
  }

  NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  configuration.timeoutIntervalForRequest = 12.0;
  NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration];
  self.attachmentTask = [session dataTaskWithURL:imageUrl completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    if (data.length > 0 && !error) {
      UNNotificationAttachment *attachment = [self attachmentFromData:data response:response sourceURL:imageUrl];
      if (attachment) {
        self.bestAttemptContent.attachments = @[attachment];
      }
    }
    [self deliverCommunicationContentWithAvatarData:data];
  }];
  [self.attachmentTask resume];
}

- (void)hydrateEncryptedPreviewIfAvailable {
  NSString *envelope = [self stringValueFromUserInfo:self.bestAttemptContent.userInfo keys:@[@"encryptedPreviewEnvelope"]];
  if (envelope.length == 0) {
    [self writeDiagnosticWithStatus:@"missing_envelope" details:nil];
    return;
  }
  NSDictionary *payload = [NotificationPreviewDecryptor decryptEnvelope:envelope];
  if (![payload isKindOfClass:[NSDictionary class]]) {
    [self writeDiagnosticWithStatus:@"decrypt_failed" details:nil];
    return;
  }
  NSString *type = payload[@"type"];
  NSString *preview = payload[@"preview"];
  NSString *senderName = payload[@"senderDisplayName"];
  if (![type isEqualToString:@"dm_message"] || ![preview isKindOfClass:[NSString class]] || preview.length == 0) {
    [self writeDiagnosticWithStatus:@"invalid_payload" details:@{
      @"payloadType": [type isKindOfClass:[NSString class]] ? type : @"",
      @"hasPreview": @([preview isKindOfClass:[NSString class]] && preview.length > 0),
    }];
    return;
  }

  self.bestAttemptContent.body = [self displayTextForPreview:preview] ?: self.bestAttemptContent.body;
  if ([senderName isKindOfClass:[NSString class]] && senderName.length > 0) {
    self.bestAttemptContent.title = senderName;
  }
  [self writeDiagnosticWithStatus:@"decrypt_success" details:@{
    @"previewLength": @(preview.length),
    @"hasSenderName": @([senderName isKindOfClass:[NSString class]] && senderName.length > 0),
  }];
}

- (void)deliverCommunicationContentWithAvatarData:(NSData *)avatarData {
  if (@available(iOS 15.0, *)) {
    NSString *senderName = [self stringValueFromUserInfo:self.bestAttemptContent.userInfo keys:@[@"senderName", @"sender_name"]];
    if (senderName.length == 0) senderName = self.bestAttemptContent.title;
    if (senderName.length == 0) {
      [self finishWithContent:self.bestAttemptContent];
      return;
    }

    NSString *senderId = [self stringValueFromUserInfo:self.bestAttemptContent.userInfo keys:@[@"senderId", @"sender_id", @"fromUserId"]];
    if (senderId.length == 0) senderId = senderName;

    NSString *conversationId = [self stringValueFromUserInfo:self.bestAttemptContent.userInfo keys:@[@"conversationId", @"conversation_id", @"groupChatId", @"channelId"]];
    if (conversationId.length == 0) conversationId = senderId;

    NSString *groupName = [self stringValueFromUserInfo:self.bestAttemptContent.userInfo keys:@[@"groupName", @"group_name"]];
    INSpeakableString *speakableGroupName = groupName.length > 0
      ? [[INSpeakableString alloc] initWithSpokenPhrase:groupName]
      : nil;

    INImage *avatar = avatarData.length > 0 ? [INImage imageWithImageData:avatarData] : nil;
    INPersonHandle *handle = [[INPersonHandle alloc] initWithValue:senderId type:INPersonHandleTypeUnknown];
    INPerson *sender = [[INPerson alloc] initWithPersonHandle:handle
                                               nameComponents:nil
                                                  displayName:senderName
                                                        image:avatar
                                            contactIdentifier:nil
                                             customIdentifier:senderId];

    INSendMessageIntent *intent = [[INSendMessageIntent alloc] initWithRecipients:nil
                                                              outgoingMessageType:INOutgoingMessageTypeOutgoingMessageText
                                                                          content:self.bestAttemptContent.body
                                                               speakableGroupName:speakableGroupName
                                                           conversationIdentifier:conversationId
                                                                      serviceName:@"CatRealm"
                                                                           sender:sender
                                                                      attachments:nil];

    INInteraction *interaction = [[INInteraction alloc] initWithIntent:intent response:nil];
    interaction.direction = INInteractionDirectionIncoming;
    [interaction donateInteractionWithCompletion:^(NSError *error) {
      NSError *updateError = nil;
      UNNotificationContent *updatedContent = [self.bestAttemptContent contentByUpdatingWithProvider:intent error:&updateError];
      [self finishWithContent:updatedContent ?: self.bestAttemptContent];
    }];
    return;
  }

  [self finishWithContent:self.bestAttemptContent];
}

- (void)finishWithContent:(UNNotificationContent *)content {
  if (self.didFinish) return;
  self.didFinish = YES;
  [self writeDiagnosticWithStatus:@"delivered" details:@{
    @"title": self.bestAttemptContent.title ?: @"",
    @"body": self.bestAttemptContent.body ?: @"",
    @"attachmentCount": @(self.bestAttemptContent.attachments.count),
  }];
  self.contentHandler(content ?: self.bestAttemptContent);
}

- (BOOL)writeDiagnosticWithStatus:(NSString *)status details:(NSDictionary *)details {
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.com.nwya.catrealm.mobile"];
  if (!defaults) return NO;
  NSMutableDictionary *payload = [@{
    @"status": status ?: @"unknown",
    @"updatedAtMs": @((long long)(NSDate.date.timeIntervalSince1970 * 1000)),
  } mutableCopy];
  if (details) [payload addEntriesFromDictionary:details];
  [defaults setObject:payload forKey:@"catrealm.notification-preview-diagnostic"];
  [defaults synchronize];
  return [defaults dictionaryForKey:@"catrealm.notification-preview-diagnostic"] != nil;
}

- (NSString *)imageUrlStringFromUserInfo:(NSDictionary *)userInfo {
  id richContent = userInfo[@"richContent"];
  if ([richContent isKindOfClass:[NSDictionary class]]) {
    id image = ((NSDictionary *)richContent)[@"image"];
    if ([image isKindOfClass:[NSString class]]) return image;
  }

  id image = userInfo[@"image"];
  if ([image isKindOfClass:[NSString class]]) return image;

  id avatarUrl = userInfo[@"avatarUrl"];
  if ([avatarUrl isKindOfClass:[NSString class]]) return avatarUrl;

  id data = userInfo[@"data"];
  if ([data isKindOfClass:[NSDictionary class]]) {
    id dataAvatarUrl = ((NSDictionary *)data)[@"avatarUrl"];
    if ([dataAvatarUrl isKindOfClass:[NSString class]]) return dataAvatarUrl;
  }

  // Expo places custom push `data` under `body` in the raw iOS APNs payload
  // that the NSE sees, then expo-notifications normalizes it back to
  // `content.data` for JavaScript consumers.
  id body = userInfo[@"body"];
  if ([body isKindOfClass:[NSDictionary class]]) {
    id bodyAvatarUrl = ((NSDictionary *)body)[@"avatarUrl"];
    if ([bodyAvatarUrl isKindOfClass:[NSString class]]) return bodyAvatarUrl;
  }

  return nil;
}

- (NSString *)stringValueFromUserInfo:(NSDictionary *)userInfo keys:(NSArray<NSString *> *)keys {
  for (NSString *key in keys) {
    id value = userInfo[key];
    if ([value isKindOfClass:[NSString class]] && ((NSString *)value).length > 0) {
      return value;
    }
  }

  id data = userInfo[@"data"];
  if ([data isKindOfClass:[NSDictionary class]]) {
    for (NSString *key in keys) {
      id value = ((NSDictionary *)data)[key];
      if ([value isKindOfClass:[NSString class]] && ((NSString *)value).length > 0) {
        return value;
      }
    }
  }

  id body = userInfo[@"body"];
  if ([body isKindOfClass:[NSDictionary class]]) {
    for (NSString *key in keys) {
      id value = ((NSDictionary *)body)[key];
      if ([value isKindOfClass:[NSString class]] && ((NSString *)value).length > 0) {
        return value;
      }
    }
  }

  return nil;
}

- (UNNotificationAttachment *)attachmentFromData:(NSData *)data response:(NSURLResponse *)response sourceURL:(NSURL *)sourceURL {
  NSString *extension = [self fileExtensionForResponse:response sourceURL:sourceURL];
  NSString *fileName = [[NSUUID UUID].UUIDString stringByAppendingPathExtension:extension];
  NSURL *fileURL = [[NSURL fileURLWithPath:NSTemporaryDirectory()] URLByAppendingPathComponent:fileName];

  NSError *writeError = nil;
  if (![data writeToURL:fileURL options:NSDataWritingAtomic error:&writeError]) {
    return nil;
  }

  NSError *attachmentError = nil;
  UNNotificationAttachment *attachment = [UNNotificationAttachment attachmentWithIdentifier:@"catrealm-avatar" URL:fileURL options:nil error:&attachmentError];
  return attachmentError ? nil : attachment;
}

- (NSString *)fileExtensionForResponse:(NSURLResponse *)response sourceURL:(NSURL *)sourceURL {
  NSString *pathExtension = sourceURL.pathExtension.lowercaseString;
  if (pathExtension.length > 0) return pathExtension;

  if ([response.MIMEType isEqualToString:@"image/jpeg"]) return @"jpg";
  if ([response.MIMEType isEqualToString:@"image/png"]) return @"png";
  if ([response.MIMEType isEqualToString:@"image/gif"]) return @"gif";
  if ([response.MIMEType isEqualToString:@"image/webp"]) return @"webp";
  if ([response.MIMEType isEqualToString:@"image/heic"]) return @"heic";
  if ([response.MIMEType isEqualToString:@"image/heif"]) return @"heif";

  return @"jpg";
}

// Replies from older senders put a [[crdmctx:…]] envelope before the reply text; show only
// the text after it. Returns nil when nothing readable is left, keeping the server's generic body.
- (NSString *)displayTextForPreview:(NSString *)preview {
  NSString *text = preview;
  if ([text hasPrefix:@"[[crdmctx:"]) {
    NSRange close = [text rangeOfString:@"]]"];
    text = close.location == NSNotFound ? @"" : [text substringFromIndex:NSMaxRange(close)];
  }
  NSArray<NSString *> *words = [text componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  text = [[words filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]] componentsJoinedByString:@" "];
  return text.length > 0 ? text : nil;
}

- (void)serviceExtensionTimeWillExpire {
  [self.attachmentTask cancel];
  [self finishWithContent:self.bestAttemptContent];
}

@end

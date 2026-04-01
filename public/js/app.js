/**
 * Created by Hongcai Deng on 2015/12/29.
 */

$(function(){
  var translations = {
    zh: {
      'brandMeta': 'Self-hosted disposable inbox with MoeMail-compatible API',
      'panel.inboxEyebrow': 'Inbox',
      'panel.inboxTitle': '邮件列表',
      'panel.inboxHint': '点击一封邮件查看详情',
      'empty.readyTitle': '收件箱已就绪',
      'empty.readyDesc': '新邮件到达后会出现在这里。你可以切换域名、复制地址，或等待外部邮件投递。',
      'table.from': '发信人',
      'table.subject': '主题',
      'table.time': '时间',
      'panel.previewEyebrow': 'Preview',
      'preview.emptyTitle': '我的邮件在哪里？',
      'preview.waitingMeta': '等待新邮件到达',
      'preview.emptyLead': '等等就来( ͡° ͜ʖ ͡°)',
      'preview.emptyDesc': '当你点击左侧邮件列表中的一封邮件时，这里会展示 HTML 预览和原始内容入口。',
      'placeholder.waiting': '请等待分配临时邮箱',
      'placeholder.custom': '请输入不带后缀邮箱账号',
      'toast.noAddress': '暂无可复制的邮箱地址',
      'toast.copied': '已复制邮箱地址',
      'toast.copyFailed': '复制失败，请手动复制',
      'button.refresh': '刷新邮箱地址',
      'button.copy': '复制邮箱地址',
      'button.customPrefix': '自定义邮箱前缀',
      'button.applyPrefix': '应用前缀',
      'toast.enterPrefix': '请输入邮箱前缀',
      'toast.invalidPrefix': '前缀仅支持字母、数字、点、横线和下划线',
      'toast.prefixApplied': '已应用自定义前缀',
      'mail.noSubject': '无主题',
      'mail.unknownFrom': '未知发件人',
      'mail.noContent': '暂无正文内容',
      'mail.metaFrom': '发件人',
      'notification.newMail': '来自 {from} 的新邮件'
    },
    en: {
      'brandMeta': 'Self-hosted disposable inbox with MoeMail-compatible API',
      'panel.inboxEyebrow': 'Inbox',
      'panel.inboxTitle': 'Messages',
      'panel.inboxHint': 'Click any message to view details',
      'empty.readyTitle': 'Inbox ready',
      'empty.readyDesc': 'New mail will appear here. You can switch domains, copy the address, or wait for external delivery.',
      'table.from': 'From',
      'table.subject': 'Subject',
      'table.time': 'Time',
      'panel.previewEyebrow': 'Preview',
      'preview.emptyTitle': 'Where is my mail?',
      'preview.waitingMeta': 'Waiting for new messages',
      'preview.emptyLead': 'It is on the way.',
      'preview.emptyDesc': 'When you click a message from the list, this panel will show the HTML preview and raw content entry.',
      'placeholder.waiting': 'Waiting for a temporary mailbox',
      'placeholder.custom': 'Enter local part without domain suffix',
      'toast.noAddress': 'No address available to copy',
      'toast.copied': 'Address copied',
      'toast.copyFailed': 'Copy failed, please copy manually',
      'button.refresh': 'Refresh mailbox address',
      'button.copy': 'Copy mailbox address',
      'button.customPrefix': 'Customize mailbox prefix',
      'button.applyPrefix': 'Apply prefix',
      'toast.enterPrefix': 'Please enter a mailbox prefix',
      'toast.invalidPrefix': 'Only letters, numbers, dots, hyphens, and underscores are allowed',
      'toast.prefixApplied': 'Custom prefix applied',
      'mail.noSubject': 'No subject',
      'mail.unknownFrom': 'Unknown sender',
      'mail.noContent': 'No message body available',
      'mail.metaFrom': 'From',
      'notification.newMail': 'New mail from {from}'
    }
  };

  var configured = window.__FORSAKEN_MAIL_CONFIG__ || {};
  var configuredDomain = configured.primaryDomain;
  var availableDomains = Array.isArray(configured.domains) ? configured.domains.filter(Boolean) : [];
  var storedDomain = null;
  try {
    storedDomain = localStorage.getItem('selectedDomain');
  } catch (error) {
    storedDomain = null;
  }
  var activeDomain = (storedDomain && availableDomains.indexOf(storedDomain) !== -1)
    ? storedDomain
    : (configuredDomain || location.hostname);
  var browserLanguage = (navigator.language || navigator.userLanguage || 'zh').toLowerCase();
  var defaultLanguage = browserLanguage.indexOf('zh') === 0 ? 'zh' : 'en';
  var language = defaultLanguage;
  try {
    language = localStorage.getItem('language') || defaultLanguage;
  } catch (error) {
    language = defaultLanguage;
  }
  var copyToastTimer = null;
  var prefixFeedbackTimer = null;

  $('.ui.modal')
    .modal()
  ;

  $customShortId = $('#customShortid');
  $shortId = $('#shortid');
  $copyAddress = $('#copyAddress');
  $copyToast = $('#copyToast');
  $domainSelect = $('#domainSelect');
  $emptyInbox = $('#emptyInbox');
  $mailContent = $('#mailContent');
  $mailPlaceholder = $('#mailPlaceholder');
  $mailMeta = $('#mailMeta');
  $customShortIdIcon = $customShortId.find('i');
  $languageToggle = $('#languageToggle');
  var hasMessages = false;
  var isEditingCustomPrefix = false;

  function t(key, params) {
    var table = translations[language] || translations.zh;
    var template = table[key] || translations.zh[key] || key;
    if(!params) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, function(_, token) {
      return params[token] !== undefined ? params[token] : '';
    });
  }

  function getLocale() {
    return language === 'zh' ? 'zh-CN' : 'en-US';
  }

  function formatMailTime(value) {
    return new Date(value).toLocaleTimeString(getLocale(), {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function refreshLanguageUI() {
    $('[data-i18n]').each(function() {
      var key = $(this).attr('data-i18n');
      $(this).text(t(key));
    });

    $('[data-i18n-title]').each(function() {
      var key = $(this).attr('data-i18n-title');
      $(this).attr('title', t(key));
    });

    $('[data-placeholder-key]').each(function() {
      var key = $(this).attr('data-placeholder-key');
      $(this).attr('placeholder', t(key));
    });

    $languageToggle.find('.languageLabel').text(language === 'zh' ? 'EN' : '中');
    $languageToggle.toggleClass('is-english', language === 'en');
    $('html').attr('lang', language === 'zh' ? 'zh-CN' : 'en');
  }

  function setLanguage(nextLanguage) {
    language = nextLanguage === 'en' ? 'en' : 'zh';
    try {
      localStorage.setItem('language', language);
    } catch (error) {
      return;
    }
    refreshLanguageUI();
  }

  function persistSelectedDomain(domain) {
    try {
      localStorage.setItem('selectedDomain', domain);
    } catch (error) {
      return;
    }
  }

  function renderDomainSelector() {
    if(availableDomains.length <= 1) {
      return;
    }

    $domainSelect.empty();
    availableDomains.forEach(function(domain) {
      var option = $('<option>').attr('value', domain).text(domain);
      if(domain === activeDomain) {
        option.prop('selected', true);
      }
      $domainSelect.append(option);
    });
    $domainSelect.show();
  }

  function showCopyToast(message, isError) {
    if(copyToastTimer) {
      clearTimeout(copyToastTimer);
    }

    $copyToast
      .text(message)
      .removeClass('green red')
      .addClass(isError ? 'red' : 'green')
      .stop(true, true)
      .fadeIn(120);

    copyToastTimer = setTimeout(function() {
      $copyToast.fadeOut(180);
    }, 1600);
  }

  function fallbackCopy(text) {
    var tempInput = $('<input type="text">').val(text).css({
      position: 'absolute',
      left: '-9999px'
    }).appendTo('body');

    tempInput[0].select();
    tempInput[0].setSelectionRange(0, text.length);

    var success = false;
    try {
      success = document.execCommand('copy');
    } finally {
      tempInput.remove();
    }

    return success;
  }

  function copyMailAddress() {
    var mailaddress = $shortId.val();
    if(!mailaddress) {
      showCopyToast(t('toast.noAddress'), true);
      return;
    }

    if(navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(mailaddress).then(function() {
        showCopyToast(t('toast.copied'));
      }).catch(function() {
        if(fallbackCopy(mailaddress)) {
          showCopyToast(t('toast.copied'));
          return;
        }
        showCopyToast(t('toast.copyFailed'), true);
      });
      return;
    }

    if(fallbackCopy(mailaddress)) {
      showCopyToast(t('toast.copied'));
      return;
    }

    showCopyToast(t('toast.copyFailed'), true);
  }

  function updateEmptyState() {
    $emptyInbox.toggle(!hasMessages);
  }

  function setInboxLoading(isLoading) {
    $maillist.toggleClass('loading', isLoading);
    $('#mailcard').toggleClass('loading', isLoading);
    if(isLoading) {
      $('#mailcard .header').text(t('preview.emptyTitle'));
      $mailMeta.text(t('preview.waitingMeta'));
    }
  }

  function buildMailRecordFromApi(message) {
    return {
      headers: {
        from: message.from_address || t('mail.unknownFrom'),
        to: message.to_address || $shortId.val(),
        subject: message.subject || t('mail.noSubject'),
        date: new Date(message.received_at || Date.now()).toISOString()
      },
      text: message.content || '',
      html: message.html || ''
    };
  }

  function renderInboxMessages(messages) {
    $maillist.empty();
    hasMessages = messages.length > 0;
    updateEmptyState();

    messages.forEach(function(message, index) {
      var mail = buildMailRecordFromApi(message);
      var $tr = $('<tr>').data('mail', mail);
      $tr
        .append($('<td>').addClass('senderCell').append($('<span>').addClass('cellText').attr('title', mail.headers.from).text(mail.headers.from)))
        .append($('<td>').addClass('subjectCell').append($('<span>').addClass('cellText').attr('title', mail.headers.subject || t('mail.noSubject')).text(mail.headers.subject || t('mail.noSubject'))))
        .append($('<td>').addClass('timeCell').append($('<span>').addClass('cellText').text(formatMailTime(mail.headers.date))));

      if(index === 0) {
        $tr.addClass('active');
      }

      $maillist.append($tr);
    });

    if(messages.length > 0) {
      renderMailPreview(buildMailRecordFromApi(messages[0]));
      return;
    }

    $mailContent.empty();
    $mailPlaceholder.show();
    $('#mailcard .header').text(t('preview.emptyTitle'));
    $mailMeta.text(t('preview.waitingMeta'));
  }

  function loadInboxHistory() {
    var address = $shortId.val();
    if(!address || address.indexOf('@') === -1) {
      renderInboxMessages([]);
      return Promise.resolve();
    }

    setInboxLoading(true);
    return fetch('/api/emails')
      .then(function(response) { return response.json(); })
      .then(function(payload) {
        var email = (payload.emails || []).find(function(item) {
          return item.address === address;
        });

        if(!email) {
          renderInboxMessages([]);
          return null;
        }

        return fetch('/api/emails/' + email.id)
          .then(function(response) { return response.json(); })
          .then(function(result) {
            renderInboxMessages(result.messages || []);
          });
      })
      .catch(function() {
        renderInboxMessages([]);
      })
      .finally(function() {
        setInboxLoading(false);
      });
  }

  function getLocalPart(address) {
    if(!address) {
      return '';
    }

    var normalized = String(address).trim();
    if(normalized.indexOf('@') !== -1) {
      return normalized.split('@')[0];
    }

    return normalized;
  }

  function setCustomPrefixMode(editing) {
    isEditingCustomPrefix = editing;
    $shortId.prop('disabled', !editing);
    $customShortId.toggleClass('active', editing);
    $customShortIdIcon.toggleClass('edit', !editing).toggleClass('check', editing);
    $customShortId.attr('title', editing ? t('button.applyPrefix') : t('button.customPrefix'));
    $shortId.parent().removeClass('invalid success');

    if(editing) {
      $shortId.val(getLocalPart($shortId.val()));
      $shortId.prop('placeholder', t('placeholder.custom'));
      $shortId.focus();
      $shortId[0].select();
      return;
    }

    $shortId.prop('placeholder', t('placeholder.waiting'));
  }

  function applyCustomPrefix() {
    var localPart = getLocalPart($shortId.val()).toLowerCase();
    if(!localPart) {
      $shortId.parent().removeClass('success').addClass('invalid');
      showCopyToast(t('toast.enterPrefix'), true);
      return;
    }

    if(!/^[a-z0-9._-]+$/.test(localPart)) {
      $shortId.parent().removeClass('success').addClass('invalid');
      showCopyToast(t('toast.invalidPrefix'), true);
      return;
    }

    $shortId.parent().removeClass('invalid').addClass('success');
    localStorage.setItem('shortid', localPart);
    setMailAddress(localPart);
    socket.emit('set shortid', { id: localPart, domain: activeDomain });
    setCustomPrefixMode(false);
    showCopyToast(t('toast.prefixApplied'));
    loadInboxHistory();

    if(prefixFeedbackTimer) {
      clearTimeout(prefixFeedbackTimer);
    }
    prefixFeedbackTimer = setTimeout(function() {
      $shortId.parent().removeClass('success');
    }, 1200);
  }

  function renderMailPreview(mail) {
    $('#mailcard .header').text(mail.headers.subject || t('mail.noSubject'));
    $mailMeta.text(t('mail.metaFrom') + ': ' + (mail.headers.from || t('mail.unknownFrom')));
    $mailPlaceholder.hide();
    $mailContent.html(mail.html || '<p>' + (mail.text || t('mail.noContent')) + '</p>');
    $('#mailcard i').off('click').on('click', function() {
      $('#raw').modal('show');
    });
    $('#raw .header').text('RAW');
    $('#raw .content').html($('<pre>').html($('<code>').addClass('language-json').html(JSON.stringify(mail, null, 2))));
    Prism.highlightAll();
  }

  $copyAddress.on('click', function() {
    copyMailAddress();
  });

  $languageToggle.on('click', function() {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  });

  $domainSelect.on('change', function() {
    activeDomain = $(this).val() || activeDomain;
    persistSelectedDomain(activeDomain);
    var currentAddress = $shortId.val();
    if(currentAddress && currentAddress.indexOf('@') !== -1) {
      var localPart = currentAddress.split('@')[0];
      setMailAddress(localPart);
    }
  });

  renderDomainSelector();
  refreshLanguageUI();

  $customShortId.on('click',function() {
    if(isEditingCustomPrefix) {
      applyCustomPrefix();
    } else {
      setCustomPrefixMode(true);
    }
  });

  $shortId.on('keydown', function(event) {
    if(!isEditingCustomPrefix) {
      return;
    }

    if(event.key === 'Enter') {
      event.preventDefault();
      applyCustomPrefix();
      return;
    }

    if(event.key === 'Escape') {
      event.preventDefault();
      setCustomPrefixMode(false);
      setMailAddress(getLocalPart(localStorage.getItem('shortid') || ''));
    }
  });

  $shortId.on('input', function() {
    if(isEditingCustomPrefix) {
      $shortId.parent().removeClass('invalid success');
    }
  });
  
  
  $maillist = $('#maillist');

  $maillist.on('click', 'tr', function() {
    var mail = $(this).data('mail');
    $maillist.find('tr').removeClass('active');
    $(this).addClass('active');
    renderMailPreview(mail);
  });

  var socket = io();

  var setMailAddress = function(id) {
    localStorage.setItem('shortid', id);
    var mailaddress = id + '@' + activeDomain;
    $('#shortid').val(mailaddress);
  };

  $('#refreshShortid').click(function() {
    socket.emit('request shortid', { domain: activeDomain });
  });

  socket.on('connect', function() {
    if(('localStorage' in window)) {
      var shortid = localStorage.getItem('shortid');
      if(!shortid) {
        socket.emit('request shortid', { domain: activeDomain });
      }
      else {
        socket.emit('set shortid', { id: shortid, domain: activeDomain });
      }
    }
  });

  socket.on('shortid', function(id) {
    setCustomPrefixMode(false);
    setMailAddress(id);
  });

  socket.on('mail', function(mail) {
    if(('Notification' in window)) {
      if(Notification.permission === 'granted') {
        new Notification(t('notification.newMail', { from: mail.headers.from }));
      }
      else if(Notification.permission !== 'denied') {
        Notification.requestPermission(function(permission) {
          if(permission === 'granted') {
            new Notification(t('notification.newMail', { from: mail.headers.from }));
          }
        })
      }
    }
    hasMessages = true;
    updateEmptyState();
    $tr = $('<tr>').data('mail', mail);
    $tr
      .append($('<td>').addClass('senderCell').append($('<span>').addClass('cellText').attr('title', mail.headers.from).text(mail.headers.from)))
      .append($('<td>').addClass('subjectCell').append($('<span>').addClass('cellText').attr('title', mail.headers.subject || t('mail.noSubject')).text(mail.headers.subject || t('mail.noSubject'))))
      .append($('<td>').addClass('timeCell').append($('<span>').addClass('cellText').text(formatMailTime(mail.headers.date))));
    $maillist.prepend($tr);

    if($maillist.find('tr.active').length === 0) {
      $tr.addClass('active');
      renderMailPreview(mail);
    }
  });

  updateEmptyState();
});

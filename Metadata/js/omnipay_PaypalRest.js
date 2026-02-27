// @see https://developer.paypal.com/docs/checkout/integrate/
(function($) {
  // Initialize CRM.payment.form for proper form handling
  CRM.payment.getBillingForm();

  var form = $('#billing-payment-block').closest('form');
  var qfKey = $('[name=qfKey]', form).val();

  if (typeof CRM.vars.omnipay === 'undefined') {
    console.log('CRM.vars.omnipay not defined! Not a Omnipay processor?');
    return;
  }

  if (typeof CRM.payment === 'undefined' || typeof CRM.payment.getTotalAmount !== 'function') {
    console.error('CRM.payment.getTotalAmount is not available. Please ensure the mjwshared extension is installed and enabled.');
    return;
  }

  function renderPaypal() {
    paypal.Buttons({


        onInit: function(data, actions) {
          // Set up the buttons.
          if (form.valid()) {
            actions.enable()
          }
          else {
            actions.disable();
          }

          form.on('blur keyup change', 'input', function (event) {
            if (form.valid()) {
              actions.enable()
            }
            else {
              actions.disable();
            }
          });
        },

        createBillingAgreement: function (data, actions) {

          var frequencyInterval = $('#frequency_interval').val() || 1;
          var frequencyUnit = $('#frequency_unit').val() ? $('#frequency_interval').val() : CRM.vars.omnipay.frequency_unit;
          var paymentAmount = CRM.payment.getTotalAmount();
          var isRecur = $('#is_recur').is(":checked");
          var recurText = isRecur ? ' recurring' : '';

          return new Promise(function (resolve, reject) {
            CRM.api3('PaymentProcessor', 'preapprove', {
                'payment_processor_id': CRM.vars.omnipay.paymentProcessorId,
                'amount': paymentAmount,
                'currencyID' : CRM.vars.omnipay.currency,
                'qf_key': qfKey,
                'is_recur' : isRecur,
                'installments' : $('#installments').val(),
                'frequency_unit' : frequencyUnit,
                'frequency_interval' : frequencyInterval,
                'description' : CRM.vars.omnipay.title + ' ' + CRM.formatMoney(paymentAmount) + recurText,
              }
            ).then(function (result) {
                if (result['is_error'] === 1) {
                  reject(result['error_message']);
                }
                else {
                  token = result['values'][0]['token'];
                  resolve(token);
                }
              })
              .fail(function (result) {
                reject('Payment failed. Check your site credentials');
              });
          });
        },

        onApprove: function (data, actions) {
          var isRecur = 1;
          var paymentToken = data['billingToken'];
          if (!paymentToken) {
            paymentToken = data['paymentID'];
            isRecur = 0;
          }

          document.getElementById('paypal-button-container').style.visibility = "hidden";
          var crmSubmitButtons = document.getElementById('crm-submit-buttons');
          if (crmSubmitButtons) {
            crmSubmitButtons.style.display = 'block';
          }

          // Insert the token into the form so it gets submitted to the server
          var tokenField = document.createElement('input');
          tokenField.setAttribute('type', 'hidden');
          tokenField.setAttribute('name', 'token');
          tokenField.setAttribute('value', paymentToken);
          CRM.payment.form.appendChild(tokenField);

          // Insert the payerID into the form so it gets submitted to the server
          var payerIDField = document.createElement('input');
          payerIDField.setAttribute('type', 'hidden');
          payerIDField.setAttribute('name', 'payerID');
          payerIDField.setAttribute('value', data['payerID']);
          CRM.payment.form.appendChild(payerIDField);

          // For Drupal webforms, we need to add the 'op' field with the submit button value
          // so webform knows which action to take (Next, Submit, etc.)
          if (CRM.payment.getIsDrupalWebform()) {
            CRM.payment.getBillingSubmit();
            if (CRM.payment.submitButtons.length > 0) {
              var submitButtonValue = CRM.payment.submitButtons[0].value;
              CRM.payment.addDrupalWebformActionElement(submitButtonValue);
            }
          }

          // Submit the form
          CRM.payment.form.submit();
        },

        onError: function(err) {
          console.log(err);
          alert('Site is not correctly configured to process payments');
        }

      })
      .render('#paypal-button-container');
  }

  var paypalScriptURL = 'https://www.paypal.com/sdk/js?client-id=' + CRM.vars.omnipay.client_id + '&currency=' + CRM.vars.omnipay.currency + '&commit=false&vault=true';
  CRM.loadScript(paypalScriptURL, false).done(renderPaypal);


})(CRM.$);

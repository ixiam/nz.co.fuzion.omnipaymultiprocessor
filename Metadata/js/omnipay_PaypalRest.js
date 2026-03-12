// @see https://developer.paypal.com/docs/checkout/integrate/
(function($) {
  // Initialize CRM.payment.form for proper form handling
  CRM.payment.getBillingForm();

  var scriptName = 'omnipayPaypal';

  if (typeof CRM.vars.omnipay === 'undefined') {
    CRM.payment.debugging(scriptName, 'CRM.vars.omnipay not defined! Not a Omnipay processor?');
    return;
  }

  console.log('Initializing PayPal REST integration');

  function getSelectedPaymentProcessorId() {
    // Drupal webform: payment processor field uses a different name
    if (CRM.payment.getIsDrupalWebform()) {
      var webformField = CRM.payment.form.querySelector('input[name="civicrm_1_contribution_1_contribution_payment_processor_id"]:checked');
      if (webformField !== null) {
        return parseInt(webformField.value);
      }
      // Only one processor on the webform (no radio buttons) – PayPal is the selected processor
      return parseInt(CRM.vars.omnipay.paymentProcessorId);
    }
    // Standard CiviCRM form
    if (CRM.payment && typeof CRM.payment.getPaymentProcessorSelectorValue === 'function') {
      return CRM.payment.getPaymentProcessorSelectorValue();
    }
    var checkedProcessor = CRM.payment.form.querySelector('input[name="payment_processor_id"]:checked');
    if (checkedProcessor !== null) {
      return parseInt(checkedProcessor.value);
    }
    var selectProcessor = CRM.payment.form.querySelector('select[name="payment_processor_id"]');
    if (selectProcessor !== null) {
      return parseInt(selectProcessor.value);
    }
    return null;
  }

  function isPaypalSelected() {
    var selectedProcessorId = getSelectedPaymentProcessorId();
    if (selectedProcessorId === null) {
      return true;
    }
    return selectedProcessorId === parseInt(CRM.vars.omnipay.paymentProcessorId);
  }

  function renderPaypal() {
    paypal.Buttons({


        onInit: function(data, actions) {

          // On webform, hide the submit button as it's triggered automatically
          if (CRM.$('[type="submit"].webform-submit').length !== 0) {
            $('[type="submit"].webform-submit').hide();
          }

          $('[type="submit"][formnovalidate="1"]',
            '[type="submit"][formnovalidate="formnovalidate"]',
            '[type="submit"].cancel',
            '[type="submit"].webform-previous'
          ).on('click', function() {
            CRM.payment.debugging(scriptName, 'adding submitdontprocess: ' + this.id);
            CRM.payment.form.dataset.submitdontprocess = 'true';
          });

          $(CRM.payment.getBillingSubmit()).on('click', function() {
            CRM.payment.debugging(scriptName, 'clearing submitdontprocess');
            CRM.payment.form.dataset.submitdontprocess = 'false';
          });

          $(CRM.payment.form).on(
            'change',
            'input[name="payment_processor_id"], select[name="payment_processor_id"], input[name="civicrm_1_contribution_1_contribution_payment_processor_id"]',
            function() {
              if (!isPaypalSelected()) {
                CRM.payment.debugging(scriptName, 'processor changed away from paypal - clearing submit block');
                CRM.payment.form.dataset.submitdontprocess = 'false';
              }
            }
          );

          $(CRM.payment.form).on('submit', function(event) {
            if (!isPaypalSelected()) {
              CRM.payment.form.dataset.submitdontprocess = 'false';
              return true;
            }
            if (CRM.payment.form.dataset.submitdontprocess === 'true') {
              CRM.payment.debugging(scriptName, 'non-payment submit detected - not submitting payment');
              event.preventDefault();
              return true;
            }
            if (document.getElementById('payment_token') && (document.getElementById('payment_token').value !== 'Authorisation token') &&
                document.getElementById('PayerID') && (document.getElementById('PayerID').value !== 'Payer ID')) {
              return true;
            }
            CRM.payment.debugging(scriptName, 'Unable to submit - paypal not executed');
            event.preventDefault();
            return true;
          });

          // Set up the buttons.
          if ($(CRM.payment.form).valid()) {
            actions.enable()
          }
          else {
            actions.disable();
          }

          $(CRM.payment.form).on('blur keyup change', 'input', function (event) {
            if ($(CRM.payment.form).valid()) {
              actions.enable();
            }
            else {
              actions.disable();
            }
          });
        },

        createBillingAgreement: function (data, actions) {

          // CRM.payment.getTotalAmount is implemented by webform_civicrm and mjwshared. The plan is to
          //   add CRM.payment.getTotalAmount() into CiviCRM core. This code allows it to work under any of
          //   these circumstances as well as if CRM.payment does not exist.
          var totalAmount = 0.0;
          if ((typeof CRM.payment !== 'undefined') && (CRM.payment.hasOwnProperty('getTotalAmount'))) {
            totalAmount = CRM.payment.getTotalAmount();
          }
          else if (typeof calculateTotalFee == 'function') {
            // This is ONLY triggered in the following circumstances on a CiviCRM contribution page:
            // - With a priceset that allows a 0 amount to be selected.
            // - When we are the ONLY payment processor configured on the page.
            totalAmount = parseFloat(calculateTotalFee());
          }
          else if (document.getElementById('total_amount')) {
            // The input#total_amount field exists on backend contribution forms
            totalAmount = parseFloat(document.getElementById('total_amount').value);
          }

          var frequencyInterval = $('#frequency_interval').val() || 1;
          var frequencyUnit = $('#frequency_unit').val() ? $('#frequency_interval').val() : CRM.vars.omnipay.frequency_unit;
          var isRecur = $('#is_recur').is(":checked");
          var recurText = isRecur ? ' recurring' : '';
          var qfKey = $('[name=qfKey]', $(CRM.payment.form)).val();

          return new Promise(function (resolve, reject) {
            CRM.api3('PaymentProcessor', 'preapprove', {
                'payment_processor_id': CRM.vars.omnipay.paymentProcessorId,
                'amount': totalAmount,
                'currencyID' : CRM.vars.omnipay.currency,
                'qf_key': qfKey,
                'is_recur' : isRecur,
                'installments' : $('#installments').val(),
                'frequency_unit' : frequencyUnit,
                'frequency_interval' : frequencyInterval,
                'description' : CRM.vars.omnipay.title + ' ' + CRM.formatMoney(totalAmount) + recurText,
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
          var paymentToken = data.billingToken;
          if (!paymentToken) {
            paymentToken = data.paymentID;
            isRecur = 0;
          }

          document.getElementById('paypal-button-container').style.visibility = "hidden";
          var crmSubmitButtons = document.getElementById('crm-submit-buttons');
          if (crmSubmitButtons) {
            crmSubmitButtons.style.display = 'block';
          }

          document.getElementById('PayerID').value = data.payerID;
          document.getElementById('payment_token').value = paymentToken;

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
          CRM.payment.debugging(scriptName, err);
          alert('Site is not correctly configured to process payments');
        }

      })
      .render('#paypal-button-container');
  }

  var paypalScriptURL = 'https://www.paypal.com/sdk/js?client-id=' + CRM.vars.omnipay.client_id + '&currency=' + CRM.vars.omnipay.currency + '&commit=false&vault=true';
  CRM.loadScript(paypalScriptURL, false).done(renderPaypal);


})(CRM.$);

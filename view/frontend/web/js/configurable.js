define([
    'jquery',
    'underscore',
    'mage/template',
    'mage/translate',
    'Magento_Catalog/js/price-utils',
    'priceBox',
    'jquery/ui',
    'jquery/jquery.parsequery'
], function ($, _, mageTemplate, $t, priceUtils) {
    'use strict';

    $.widget('mage.configurable', {
        component: 'Magento_ConfigurableProduct/js/configurable',
        options: {
            superSelector: '.product-info-main .super-attribute-select',
            selectSimpleProduct: '[name="selected_configurable_option"]',
            priceHolderSelector: '.price-box',
            spConfig: {},
            state: {},
            priceFormat: {},
            optionTemplate: '<%- data.label %>' +
            '<% if (typeof data.finalPrice.value !== "undefined") { %>' +
            ' <%- data.finalPrice.formatted %>' +
            '<% } %>',
            mediaGallerySelector: '[data-gallery-role=gallery-placeholder]',
            mediaGalleryInitial: null,
            slyOldPriceSelector: '.sly-old-price',

            /**
             * Defines the mechanism of how images of a gallery should be
             * updated when user switches between configurations of a product.
             *
             * As for now value of this option can be either 'replace' or 'prepend'.
             *
             * @type {String}
             */
            gallerySwitchStrategy: 'replace',
            tierPriceTemplateSelector: '#tier-prices-template',
            tierPriceBlockSelector: '[data-role="tier-price-block"]',
            tierPriceTemplate: '',
            selectorProduct: '.product-info-main, .product-info-wrapper',
            selectorProductPrice: '[data-role=priceBox]'
        },

        _create: function () {
            if (this._getPriceBoxElement().priceBox('instance')) {
                this._onPriceFormatReady();
            } else {
                this._getPriceBoxElement()
                    .first()
                    .one('price-box-initialized', this._onPriceFormatReady.bind(this));
            }
        },

        _onPriceFormatReady: function () {
            // Initial setting of various option values
            this._initializeOptions();

            // Override defaults with URL query parameters and/or inputs values
            this._overrideDefaults();

            // Change events to check select reloads
            this._setupChangeEvents();

            // Fill state
            this._fillState();

            // Setup child and prev/next settings
            this._setChildSettings();

            // Setup/configure values to inputs
            this._configureForValues();

            $(this.element).trigger('configurable.initialized');
        },

        /**
         * Initialize tax configuration, initial settings, and options values.
         * @private
         */
        _initializeOptions: function () {
            var options = this.options,
                gallery = $(options.mediaGallerySelector),
                priceBoxOptions = this._getPriceBoxElement().priceBox('option').priceConfig || null;

            if (priceBoxOptions && priceBoxOptions.optionTemplate) {
                options.optionTemplate = priceBoxOptions.optionTemplate;
            }

            if (priceBoxOptions && priceBoxOptions.priceFormat) {
                options.priceFormat = priceBoxOptions.priceFormat;
            }
            options.optionTemplate = mageTemplate(options.optionTemplate);
            options.tierPriceTemplate = $(this.options.tierPriceTemplateSelector).html();

            options.settings = options.spConfig.containerId ?
                $(options.spConfig.containerId).find(options.superSelector) :
                $(options.superSelector);

            options.values = options.spConfig.defaultValues || {};
            options.parentImage = $('[data-role=base-image-container] img').attr('src');

            this.inputSimpleProduct = this.element.find(options.selectSimpleProduct);

            gallery.data('gallery') ?
                this._onGalleryLoaded(gallery) :
                gallery.on('gallery:loaded', this._onGalleryLoaded.bind(this, gallery));

        },

        /**
         * Override default options values settings with either URL query parameters or
         * initialized inputs values.
         * @private
         */
        _overrideDefaults: function () {
            var hashIndex = window.location.href.indexOf('#');

            if (hashIndex !== -1) {
                this._parseQueryParams(window.location.href.substr(hashIndex + 1));
            }

            if (this.options.spConfig.inputsInitialized) {
                this._setValuesByAttribute();
            }

            this._setInitialOptionsLabels();
        },

        /**
         * Set additional field with initial label to be used when switching between options with different prices.
         */
        _setInitialOptionsLabels: function () {
            $.each(this.options.spConfig.attributes, function (index, element) {
                $.each(element.options, function (optIndex, optElement) {
                    if (!optElement.initialLabel) {
                        this.options.spConfig.attributes[index].options[optIndex].initialLabel = optElement.label;
                    }
                }.bind(this));
            }.bind(this));
        },

        /**
         * Parse query parameters from a query string and set options values based on the
         * key value pairs of the parameters.
         * @param {*} queryString - URL query string containing query parameters.
         * @private
         */
        _parseQueryParams: function (queryString) {
            var queryParams = $.parseQuery(queryString);

            $.each(queryParams, function (key, value) {
                if (this.options.spConfig.attributes[key] !== undefined &&
                    _.find(this.options.spConfig.attributes[key].options, function (element) {
                        return element.id === value;
                    })) {
                    this.options.values[key] = value;
                }
            }.bind(this));
        },

        /**
         * Override default options values with values based on each element's attribute
         * identifier.
         * @private
         */
        _setValuesByAttribute: function () {
            this.options.values = {};
            $.each(this.options.settings, $.proxy(function (index, element) {
                var attributeId;

                if (element.value) {
                    attributeId = element.id.replace(/[a-z]*/, '');
                    this.options.values[attributeId] = element.value;
                }
            }, this));
        },

        /**
         * Set up .on('change') events for each option element to configure the option.
         * @private
         */
        _setupChangeEvents: function () {
            $.each(this.options.settings, function (index, element) {
                $(element).on('change', this, this._configure);
            }.bind(this));
        },

        /**
         * Iterate through the option settings and set each option's element configuration,
         * attribute identifier. Set the state based on the attribute identifier.
         * @private
         */
        _fillState: function () {
            $.each(this.options.settings, $.proxy(function (index, element) {
                var attributeId = element.id.replace(/[a-z]*/, '');
                if (attributeId && this.options.spConfig.attributes[attributeId]) {
                    element.config = this.options.spConfig.attributes[attributeId];
                    element.attributeId = attributeId;
                    this.options.state[attributeId] = false;
                }
                var elem = document.getElementById("attribute"+attributeId);
            }, this));
        },

        /**
         * Set each option's child settings, and next/prev option setting. Fill (initialize)
         * an option's list of selections as needed or disable an option's setting.
         * @private
         */
        _setChildSettings: function () {
            var childSettings = [],
                settings = this.options.settings,
                index = settings.length,
                option;

            while (index--) {
                option = settings[index];

                if (index) {
                    option.disabled = true;
                } else {
                    this._fillSelect(option);
                }

                _.extend(option, {
                    childSettings: childSettings.slice(),
                    prevSetting: settings[index - 1],
                    nextSetting: settings[index + 1]
                });

                childSettings.push(option);
            }
        },

        /**
         * Setup for all configurable option settings. Set the value of the option and configure
         * the option, which sets its state, and initializes the option's choices, etc.
         * @private
         */
        _configureForValues: function () {
            var productLength = 0;
            var updateProductId = '';
            var ajaxcall = 0;
            var optionSelectedSCP = 0;
            if (this.options.values) {
                this.options.settings.each($.proxy(function (index, element) {

                    var attributeId = element.attributeId;
                    var currentUrl = new URL(window.location.href);
                    var currentBaseUrl = currentUrl.origin + currentUrl.pathname;
                    var simpleProductId = '';
                    var selectedOptionId = '';
                    var selectedLabel = '';
                    if (typeof this.options.productUrls !== 'undefined') {
                        $.each(this.options.productUrls, function (productId, productUrl) {
                            if (productUrl == currentBaseUrl) {
                                simpleProductId = productId;
                                updateProductId = productId;
                                ajaxcall = 1;
                                return true;
                            }
                        });
                    }
                    $.each(this.options.spConfig.attributes, function () {
                        var item = this;
                        if (item.id == attributeId) {
                            var allOptions = item.options;
                            $.each(allOptions, function (key, optionObj) {
                                var products = optionObj.products;
                                productLength = products.length;
                                for (var i = 0; i < products.length; i++) {
                                    var childProductId = optionObj.products[i];
                                    if (simpleProductId === childProductId) {
                                       selectedOptionId = optionObj.id;
                                       optionSelectedSCP++;
                                    }
                                }
                            });
                        }
                    });
                    if (selectedOptionId !== '') {
                        element.value = selectedOptionId;
                        if (this.options.settings.length == optionSelectedSCP) {
                            $('.product-info-main .product-info-price').show();
                            $(document).trigger('processEstimatedDateEvent', [updateProductId]);
                        }
                    }
                    else{
                        element.value = this.options.values[attributeId] || '';
                    }
                    if (productLength >= 1) {
                    var page_url = $("#url").val();
                    if(ajaxcall == 1 && page_url !== undefined && page_url != " "){ // Breeze fix
                            $.ajax({
                                type: "POST",
                                url: page_url,
                                data : 'id='+ updateProductId,
                                dataType: "json",
                                success: function(data){
                                    if(data.status == "success"){
                                         $('.show_qty').html(data.success_message);
                                    }else{
                                        $('.show_qty').html();
                                    }
                                }
                            });
                        }
                    }
                    this._configureElement(element);
                }, this));
            }
        },

        /**
         * Event handler for configuring an option.
         * @private
         * @param {Object} event - Event triggered to configure an option.
         */
        _configure: function (event) {
            event.data._configureElement(this);
        },

        /**
         * Configure an option, initializing it's state and enabling related options, which
         * populates the related option's selection and resets child option selections.
         * @private
         * @param {*} element - The element associated with a configurable option.
         */
        _configureElement: function (element) {
            // this.setupInterval();
            this.simpleProduct = this._getSimpleProductId(element);
            var simpleId= this.simpleProduct;

            if (typeof this.options.customAttributes[this.simpleProduct] !== 'undefined') {
                $.each(this.options.customAttributes[this.simpleProduct], function (attributeCode, data) {
                    var $block = $(data.class);
                    if (typeof data.replace != 'undefined' && data.replace) {
                        if (data.value == '') {
                            $block.remove();
                        }

                        if ($block.length > 0) {
                            $block.replaceWith(data.value);
                        } else {
                            $(data.container).html(data.value);
                        }
                    } else {
                        if ($block.length > 0) {
                            if($block.selector && $block.selector.includes('meta')){
                                $($block.selector).attr('content', data.value);
                            }
                            else{
                                $block.html(data.value);
                            }
                        }
                    }
                });

                if (this.simpleProduct && document.getElementsByName('product').length) {
                    document.getElementsByName('product')[0].value = this.simpleProduct;
                }
                var config = this.options;
                require(['jqueryHistory'], function () {
                    if (config.replaceUrl && typeof config.productUrls[simpleId] !== 'undefined') {
                        var url = config.productUrls[simpleId];
                        var title = null;
                        if (config.customAttributes[simpleId].name.value !== 'undefined') {
                            title = config.customAttributes[simpleId].name.value;
                        }
                        var queryString = window.location.search;
                        if (queryString) {
                            window.history.replaceState(null, title, url+queryString); // Breeze fix for jqueryHistory
                        } else {
                            window.history.replaceState(null, title, url); // Breeze fix for jqueryHistory
                        }
                    }
                });
                var productLength = document.getElementsByName('product').length;
                if (productLength >= 1) {
                var page_url = $("#url").val();
                if(page_url !== undefined && page_url != ""){ // Breeze fix
                        $.ajax({
                            type: "POST",
                            url: page_url,
                            data : 'id='+ simpleId,
                            dataType: "json",
                            success: function(data){
                                if(data.status == "success"){
                                     $('.show_qty').html(data.success_message);
                                }else{
                                    $('.show_qty').html();
                                }
                            }
                        });
                    }
                }

            }

            if (this.options.replaceBreadCrumbsData && typeof this.options.breadCrumbsData[this.simpleProduct] !== 'undefined') {
                var breadCrumb =this.options.breadCrumbsData[this.simpleProduct];
                if (breadCrumb !== 'undefined') {
                    $('div.breadcrumbs .items .product').html('<strong>'+breadCrumb+'</strong>');
                }
            }

            $(document).trigger('processScpRecentProductDataEvent', [this.simpleProduct]);

            if (element.value) {
                this.options.state[element.config.id] = element.value;

                if (element.nextSetting) {
                    element.nextSetting.disabled = false;
                    var nextId = element.nextSetting.id;
                    var nextSelectedVal = $("#" + nextId).val();
                    this._fillSelect(element.nextSetting);
                    //this._resetChildren(element.nextSetting);
                    // if (nextSelectedVal.length) {
                    if ($("#" + nextId).length) {
                        if($("#" + nextId +" option[value='"+nextSelectedVal+"']").length) {
                            $("#" + nextId).val(nextSelectedVal);
                            $("#" + nextId).trigger('change'); // Breeze fix
                        }else{
                            $("#" + nextId).val($("#" + nextId+" option[value!='']:first").val());
                            $("#" + nextId).trigger('change'); // Breeze fix
                        }

                    }
                } else {
                    if (!!document.documentMode) { //eslint-disable-line
                        this.inputSimpleProduct.val(element.options[element.selectedIndex].config.allowedProducts[0]);
                    } else {
                        this.inputSimpleProduct.val(element.selectedOptions[0].config.allowedProducts[0]);
                    }
                }
            } else {
                this._resetChildren(element);
            }

            this._reloadPrice();
            this._displayRegularPriceBlock(this.simpleProduct);
            this._displayTierPriceBlock(this.simpleProduct);
            this._changeProductImage();
            this._disableEmptyFirstOption();
        },

        /**
         * Function to disable the first option in select elements with
         * class "super-attribute-select" and name containing "super_attribute"
         */
        _disableEmptyFirstOption: function () {
            this.element.find('select.super-attribute-select[name^="super_attribute"]').each(function () {
                var firstOption = $(this).find('option').first();
                if (firstOption.val() === '') {
                    firstOption.prop('disabled', true);
                }
            });
        },

         setupInterval: (function() {
            var interval;
            return function() {
                if (!interval) {
                    interval = setInterval(function() {
                        $('.super-attribute-select').trigger('change');
                    }, 1000);
                    $('.super-attribute-select').one('change', function() {
                        clearInterval(interval);
                    });
                }
            };
        })(),

        /**
         * Change displayed product image according to chosen options of configurable product
         */
        _changeProductImage: function () {
            var images,
                initialImages = this.options.mediaGalleryInitial,
                galleryEl = $(this.options.mediaGallerySelector),
                gallery;

            if (galleryEl.gallery) {
                gallery = galleryEl.gallery('instance');
            }

            if (_.isUndefined(gallery)) {
                galleryEl.on('gallery:loaded', function () {
                    this._changeProductImage();
                }.bind(this));

                return;
            }

            images = this.options.spConfig.images[this.simpleProduct];

            if (images) {
                images = this._sortImages(images);

                if (this.options.gallerySwitchStrategy === 'prepend') {
                    images = images.concat(initialImages);
                }

                images = $.extend(true, [], images);
                images = this._setImageIndex(images);

                gallery.updateData(images);
            } else {
                gallery.updateData(initialImages);
            }
        },

        _sortImages: function (images) {
            return _.sortBy(images, function (image) {
                return image.position;
            });
        },

        /**
         * Set correct indexes for image set.
         *
         * @param {Array} images
         * @private
         */
        _setImageIndex: function (images) {
            var length = images.length,
                i;

            for (i = 0; length > i; i++) {
                images[i].i = i + 1;
            }

            return images;
        },

        /**
         * For a given option element, reset all of its selectable options. Clear any selected
         * index, disable the option choice, and reset the option's state if necessary.
         * @private
         * @param {*} element - The element associated with a configurable option.
         */
        _resetChildren: function (element) {
            if (element.childSettings) {
                _.each(element.childSettings, function (set) {
                    set.selectedIndex = 0;
                    set.disabled = true;
                });

                if (element.config) {
                    this.options.state[element.config.id] = false;
                }
            }
        },

        /**
         * Populates an option's selectable choices.
         * @private
         * @param {*} element - Element associated with a configurable option.
         */
        _fillSelect: function (element) {
            var attributeId = element.id.replace(/[a-z]*/, ''),
                options = this._getAttributeOptions(attributeId),
                prevConfig,
                index = 1,
                allowedProducts,
                i,
                j;


            this._clearSelect(element);
            element.options[0] = new Option('', '');
            element.options[0].innerHTML = this.options.spConfig.chooseText;
            prevConfig = false;

            if (element.prevSetting) {
                prevConfig = element.prevSetting.options[element.prevSetting.selectedIndex];
            }
            if (options) {
                 if (typeof this.options.preSelectedOption !== 'undefined') {
                    var preSelectedOption = this.options.preSelectedOption;
                    var preSelectMap = {};

                    $.each(preSelectedOption, $.proxy(function (preattributeId, preoptionId) {
                        preSelectMap[preattributeId] = preoptionId;
                    }));
                }

                for (i = 0; i < options.length; i++) {
                    allowedProducts = [];

                    /* eslint-disable max-depth */
                    if (prevConfig) {
                        for (j = 0; j < options[i].products.length; j++) {
                            // prevConfig.config can be undefined
                            if (prevConfig.config &&
                                prevConfig.config.allowedProducts &&
                                prevConfig.config.allowedProducts.indexOf(options[i].products[j]) > -1) {
                                allowedProducts.push(options[i].products[j]);
                            }
                        }
                    } else {
                        allowedProducts = options[i].products.slice(0);
                    }

                    if (allowedProducts.length > 0) {
                        options[i].allowedProducts = allowedProducts;
                        element.options[index] = new Option(this._getOptionLabel(options[i]), options[i].id);

                        if (typeof options[i].price !== 'undefined') {
                            element.options[index].setAttribute('price', options[i].prices);
                        }

                        element.options[index].config = options[i];
                        index++;
                    }

                    var url = window.location.href.substr(window.location.href.indexOf('#') + 1);
                    var substring = "checkout/cart/configure";
                    /* eslint-enable max-depth */
                    if (typeof this.options.preSelectedOption === 'object' && !Array.isArray(this.options.preSelectedOption) && this.options.preSelectedOption !== null) {
                        // updates backend Preselect option value
                        if (url.indexOf(substring) == -1) {
                          this.options.values[attributeId] = preSelectMap[attributeId];
                        }

                    }else{
                        if(this.options.isExtensionEnable!=0 && this.options.isFirstSelected == 0){
                            // updates the value to first option
                            if (i == 0 && url.indexOf(substring) == -1) {
                                this.options.values[attributeId] = options[i].id;
                            }
                        }

                    }
                }
                //new code here checks if configurations are set in url and resets them if needed
            if (window.location.href.indexOf('#') !== -1) {this._parseQueryParams(window.location.href.substr(window.location.href.indexOf('#') + 1));}
            }
        },

        /**
         * Generate the label associated with a configurable option. This includes the option's
         * label or value and the option's price.
         * @private
         * @param {*} option - A single choice among a group of choices for a configurable option.
         * @return {String} The option label with option value and price (e.g. Black +1.99)
         */
        _getOptionLabel: function (option) {
            return option.label;
        },

        /**
         * Removes an option's selections.
         * @private
         * @param {*} element - The element associated with a configurable option.
         */
        _clearSelect: function (element) {
            var i;

            for (i = element.options.length - 1; i >= 0; i--) {
                element.remove(i);
            }
        },

        /**
         * Retrieve the attribute options associated with a specific attribute Id.
         * @private
         * @param {Number} attributeId - The id of the attribute whose configurable options are sought.
         * @return {Object} Object containing the attribute options.
         */
        _getAttributeOptions: function (attributeId) {
            if (this.options.spConfig.attributes[attributeId]) {
                return this.options.spConfig.attributes[attributeId].options;
            }
        },

        /**
         * Reload the price of the configurable product incorporating the prices of all of the
         * configurable product's option selections.
         */
        _reloadPrice: function () {
            this._getPriceBoxElement().trigger('updatePrice', this._getPrices());
        },

        /**
         * Get product various prices
         * @returns {{}}
         * @private
         */
        _getPrices: function () {
            var prices = {},
                elements = _.toArray(this.options.settings),
                hasProductPrice = false;

            _.each(elements, function (element) {
                var selected = element.options[element.selectedIndex],
                    config = selected && selected.config,
                    priceValue = {};

                if (config && config.allowedProducts.length === 1 && !hasProductPrice) {
                    priceValue = this._calculatePrice(config);
                    hasProductPrice = true;
                }

                prices[element.attributeId] = priceValue;
            }, this);

            return prices;
        },

        /**
         * Returns prices for configured products
         *
         * @param {*} config - Products configuration
         * @returns {*}
         * @private
         */
        _calculatePrice: function (config) {
            var displayPrices = this._getPriceBoxElement().priceBox('option').prices,
                newPrices = this.options.spConfig.optionPrices[_.first(config.allowedProducts)];

            _.each(displayPrices, function (price, code) {
                if (newPrices[code]) {
                    displayPrices[code].amount = newPrices[code].amount - displayPrices[code].amount;
                }
            });

            return displayPrices;
        },

        /**
         * Returns Simple product Id
         *  depending on current selected option.
         *
         * @private
         * @param {HTMLElement} element
         * @returns {String|undefined}
         */
        _getSimpleProductId: function (element) {
            // TODO: Rewrite algorithm. It should return ID of
            //        simple product based on selected options.
            var allOptions = element.config.options,
                value = element.value,
                config;

            config = _.filter(allOptions, function (option) {
                return option.id === value;
            });
            config = _.first(config);

            return _.isEmpty(config) ?
                undefined :
                _.first(config.allowedProducts);

        },

        /**
         * Show or hide regular price block
         *
         * @param {*} optionId
         * @private
         */
        _displayRegularPriceBlock: function (optionId) {
            if (typeof optionId != 'undefined' &&
                this.options.spConfig.optionPrices[optionId].oldPrice.amount != //eslint-disable-line eqeqeq
                this.options.spConfig.optionPrices[optionId].finalPrice.amount
            ) {
                $(this.options.slyOldPriceSelector).show();
            } else {
                $(this.options.slyOldPriceSelector).hide();
            }
        },

        /**
         * Callback which fired after gallery gets initialized.
         *
         * @param {HTMLElement} element - DOM element associated with gallery.
         */
        _onGalleryLoaded: function (element) {
            var galleryObject = element.data('gallery');

            this.options.mediaGalleryInitial = galleryObject.returnCurrentImages();
        },

        /**
         * Show or hide tier price block
         *
         * @param {*} optionId
         * @private
         */
        _displayTierPriceBlock: function (optionId) {
            var options, tierPriceHtml;

            if (typeof optionId != 'undefined' &&
                this.options.spConfig.optionPrices[optionId].tierPrices != [] // eslint-disable-line eqeqeq
            ) {
                options = this.options.spConfig.optionPrices[optionId];

                if (this.options.tierPriceTemplate) {
                    tierPriceHtml = mageTemplate(this.options.tierPriceTemplate, {
                        'tierPrices': options.tierPrices,
                        '$t': $t,
                        'currencyFormat': this.options.spConfig.currencyFormat,
                        'priceUtils': priceUtils
                    });
                    $(this.options.tierPriceBlockSelector).html(tierPriceHtml).show();
                }
            } else {
                $(this.options.tierPriceBlockSelector).hide();
            }
        },

        /**
         * Returns the price container element
         *
         * @returns {*}
         * @private
         */
        _getPriceBoxElement: function () {
            return this.element
                .parents(this.options.selectorProduct)
                .find(this.options.selectorProductPrice);
        }
    });

    return $.mage.configurable;
});
